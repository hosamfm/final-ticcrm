const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/User');

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error_msg: 'Please log in to view that resource' });
}

async function getDatabase(req) {
    let databaseName;
    if (req.user.role === 'employee') {
        const employer = await User.findById(req.user.company);
        databaseName = employer.database;
    } else {
        databaseName = req.user.database;
    }
    if (!databaseName) {
        throw new Error('Database not specified for this user');
    }
    return mongoose.connection.useDb(databaseName);
}

router.get('/', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        const pipeline = [
            {
                "$lookup": {
                    "from": "tbl_gl",
                    "let": { "acc_id": "$cu_acc_id" },
                    "pipeline": [
                        { 
                            "$match": { 
                                "$expr": { 
                                    "$and": [
                                        { "$eq": ["$gl_ac_id", "$$acc_id"] },
                                        { "$eq": ["$gl_post", 1] }
                                    ]
                                }
                            }
                        },
                        {
                            "$group": {
                                "_id": "$gl_currency_id",
                                "total_gl_debit": { "$sum": "$gl_debit" },
                                "total_gl_credit": { "$sum": "$gl_credit" }
                            }
                        },
                        {
                            "$project": {
                                "currency_id": "$_id",
                                "total_gl_debit": { "$round": ["$total_gl_debit", 0] },
                                "total_gl_credit": { "$round": ["$total_gl_credit", 0] }
                            }
                        }
                    ],
                    "as": "gl_records"
                }
            },
            {
                "$unwind": {
                    "path": "$gl_records",
                    "preserveNullAndEmptyArrays": true
                }
            },
            {
                "$lookup": {
                    "from": "tbl_currency",
                    "localField": "gl_records.currency_id",
                    "foreignField": "cur_lst_id",
                    "as": "currency_info"
                }
            },
            {
                "$unwind": {
                    "path": "$currency_info",
                    "preserveNullAndEmptyArrays": true
                }
            },
            {
                "$project": {
                    "customer_id": "$_id",
                    "customer_name": "$cu_name",
                    "currency_name": "$currency_info.cur_lst_name",
                    "total_gl_debit": { "$ifNull": ["$gl_records.total_gl_debit", 0] },
                    "total_gl_credit": { "$ifNull": ["$gl_records.total_gl_credit", 0] },
                    "currency_id": "$gl_records.currency_id",
                    "balance": {
                        "$cond": {
                            "if": { "$lt": [{ "$abs": { "$subtract": ["$gl_records.total_gl_debit", "$gl_records.total_gl_credit"] } }, 5] },
                            "then": 0,
                            "else": { "$subtract": ["$gl_records.total_gl_debit", "$gl_records.total_gl_credit"] }
                        }
                    }
                }
            },
            {
                "$sort": {
                    "customer_name": 1,
                    "currency_name": 1
                }
            }
        ];
        const customers = await db.collection('tbl_cust').aggregate(pipeline).toArray();
        customers.forEach(customer => {
            customer.balance = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(customer.balance);
        });

        res.json(customers);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error_msg: 'An error occurred while fetching customers' });
    }
});

router.get('/loadAll', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        const pipeline = [
            {
                "$lookup": {
                    "from": "tbl_gl",
                    "let": { "acc_id": "$cu_acc_id" },
                    "pipeline": [
                        { 
                            "$match": { 
                                "$expr": { 
                                    "$and": [
                                        { "$eq": ["$gl_ac_id", "$$acc_id"] },
                                        { "$eq": ["$gl_post", 1] }
                                    ]
                                }
                            }
                        },
                        {
                            "$group": {
                                "_id": "$gl_currency_id",
                                "total_gl_debit": { "$sum": "$gl_debit" },
                                "total_gl_credit": { "$sum": "$gl_credit" }
                            }
                        },
                        {
                            "$project": {
                                "currency_id": "$_id",
                                "total_gl_debit": { "$round": ["$total_gl_debit", 0] },
                                "total_gl_credit": { "$round": ["$total_gl_credit", 0] }
                            }
                        }
                    ],
                    "as": "gl_records"
                }
            },
            {
                "$unwind": {
                    "path": "$gl_records",
                    "preserveNullAndEmptyArrays": true
                }
            },
            {
                "$lookup": {
                    "from": "tbl_currency",
                    "localField": "gl_records.currency_id",
                    "foreignField": "cur_lst_id",
                    "as": "currency_info"
                }
            },
            {
                "$unwind": {
                    "path": "$currency_info",
                    "preserveNullAndEmptyArrays": true
                }
            },
            {
                "$project": {
                    "customer_id": "$_id",
                    "customer_name": "$cu_name",
                    "currency_name": "$currency_info.cur_lst_name",
                    "total_gl_debit": { "$ifNull": ["$gl_records.total_gl_debit", 0] },
                    "total_gl_credit": { "$ifNull": ["$gl_records.total_gl_credit", 0] },
                    "currency_id": "$gl_records.currency_id",
                    "balance": {
                        "$cond": {
                            "if": { "$lt": [{ "$abs": { "$subtract": ["$gl_records.total_gl_debit", "$gl_records.total_gl_credit"] } }, 5] },
                            "then": 0,
                            "else": { "$subtract": ["$gl_records.total_gl_debit", "$gl_records.total_gl_credit"] }
                        }
                    }
                }
            },
            {
                "$sort": {
                    "customer_name": 1,
                    "currency_name": 1
                }
            }
        ];
        const customers = await db.collection('tbl_cust').aggregate(pipeline).toArray();
        customers.forEach(customer => {
            customer.balance = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(customer.balance);
        });
        res.json(customers);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'An error occurred while fetching customers' });
    }
});

router.get('/:id', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        const customerId = req.params.id;
        const objectId = new mongoose.Types.ObjectId(customerId);
        const customer = await db.collection('tbl_cust').findOne({ _id: objectId });
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        res.json(customer);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'An error occurred while fetching customer details' });
    }
});

module.exports = router;
