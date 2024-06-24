const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../utils/helpers');
const mongoose = require('mongoose');
const User = require('../models/User');
const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 600 }); // التخزين المؤقت لمدة 10 دقائق

mongoose.connect(process.env.DATABASE_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));

async function getDatabase(req) {
    if (!req.user) {
        throw new Error('User is not authenticated');
    }

    let databaseName = req.user.database;

    if (!databaseName && req.user.role === 'employee') {
        const employer = await User.findById(req.user.company).exec();
        if (!employer) {
            throw new Error('Employer not found');
        }
        databaseName = employer.database;
    }

    if (!databaseName) {
        throw new Error('Database name is not defined');
    }

    return mongoose.connection.useDb(databaseName);
}

async function calculateCustomerBalance(db, customerId) {
    const pipeline = [
        { "$match": { "gl_ac_id": customerId, "gl_post": 1 } },
        { "$group": { "_id": "$gl_currency_id", "total_gl_debit": { "$sum": "$gl_debit" }, "total_gl_credit": { "$sum": "$gl_credit" } } },
        { "$lookup": { "from": "tbl_currency", "localField": "_id", "foreignField": "cur_lst_id", "as": "currency_info" } },
        { "$unwind": "$currency_info" },
        { "$project": {
            "currency_name": "$currency_info.cur_lst_name",
            "total_gl_debit": { "$ifNull": ["$total_gl_debit", 0] },
            "total_gl_credit": { "$ifNull": ["$total_gl_credit", 0] },
            "balance": {
                "$cond": {
                    "if": { "$lt": [{ "$abs": { "$subtract": ["$total_gl_debit", "$total_gl_credit"] } }, 5] },
                    "then": 0,
                    "else": { "$subtract": ["$total_gl_debit", "$total_gl_credit"] }
                }
            }
        } }
    ];

    return db.collection('tbl_gl').aggregate(pipeline).toArray();
}

async function calculateCustomerReminders(db, customerId) {
    const reminders = await db.collection('sentmessages').aggregate([
        { "$match": { "customerName": customerId } },
        { "$group": { "_id": "$customerName", "totalReminders": { "$sum": 1 }, "lastReminderDate": { "$max": "$sendDate" } } }
    ]).toArray();

    return reminders.length > 0 ? reminders[0] : { totalReminders: 0, lastReminderDate: null };
}

async function calculateInvoiceReminders(db, invoiceId) {
    const reminders = await db.collection('sentinvoices').aggregate([
        { "$match": { "invoiceId": invoiceId } },
        { "$group": { "_id": "$invoiceId", "totalReminders": { "$sum": 1 } } }
    ]).toArray();

    return reminders.length > 0 ? reminders[0].totalReminders : 0;
}

async function getLastFiveReminders(db, invoiceId) {
    const reminders = await db.collection('sentinvoices').aggregate([
        { $match: { invoiceId: invoiceId } },
        { $sort: { sendDate: -1 } },
        { $limit: 5 },
        { $lookup: {
            from: 'sentmessages',
            localField: 'messageId',
            foreignField: '_id',
            as: 'messageDetails'
        }},
        { $unwind: '$messageDetails' },
        { $project: { sendDate: '$messageDetails.sendDate' } }
    ]).toArray();

    return reminders.map(reminder => {
        const sendDate = new Date(reminder.sendDate);
        reminder.sendDate = !isNaN(sendDate) ? sendDate.toISOString() : "Invalid Date";
        return reminder;
    });
}

function createDueInvoicesPipeline(customerName = null) {
    const pipeline = [
        { "$match": { "in_due_calc_status": { "$ne": "مدفوع" } } }, 
        { 
            "$lookup": { 
                "from": "tbl_invoice_list", 
                "localField": "in_due_inv_id", 
                "foreignField": "in_list_id", 
                "as": "invoice_details",
                "pipeline": [
                    { "$project": { "in_list_id": 1, "in_list_number": 1, "in_list_datetime": 1, "in_list_desc": 1, "in_list_net": 1, "in_list_payment": 1, "in_list_remind": 1, "in_list_acc_cust": 1, "in_list_agent_id": 1, "in_list_currency_id": 1, "in_list_type_id": 1 } }
                ]
            } 
        },
        { "$unwind": "$invoice_details" },
        { 
            "$lookup": { 
                "from": "tbl_cust", 
                "localField": "in_due_inv_acc_id", 
                "foreignField": "cu_acc_id", 
                "as": "customer_details",
                "pipeline": [
                    { "$project": { "cu_acc_id": 1, "cu_name": 1, "cu_company": 1, "cu_address": 1, "cu_mobile1": 1, "cu_mobile2": 1, "cu_email": 1 } }
                ]
            } 
        },
        { "$unwind": "$customer_details" },
    ];

    if (customerName) {
        pipeline.push({ "$match": { "customer_details.cu_name": customerName } });
    }

    pipeline.push(
        { 
            "$lookup": { 
                "from": "tbl_agent", 
                "localField": "invoice_details.in_list_agent_id", 
                "foreignField": "ag_id", 
                "as": "agent_details",
                "pipeline": [
                    { "$project": { "ag_id": 1, "ag_name": 1 } }
                ]
            } 
        },
        { "$unwind": { "path": "$agent_details", "preserveNullAndEmptyArrays": true } },
        { 
            "$lookup": { 
                "from": "tbl_currency", 
                "localField": "invoice_details.in_list_currency_id", 
                "foreignField": "cur_lst_id", 
                "as": "currency_details",
                "pipeline": [
                    { "$project": { "cur_lst_id": 1, "cur_lst_name": 1 } }
                ]
            } 
        },
        { "$unwind": { "path": "$currency_details", "preserveNullAndEmptyArrays": true } },
        { 
            "$lookup": { 
                "from": "tbl_invoice_type", 
                "localField": "invoice_details.in_list_type_id", 
                "foreignField": "in_type_id", 
                "as": "invoice_type_details",
                "pipeline": [
                    { "$project": { "in_type_id": 1, "in_type_name": 1 } }
                ]
            } 
        },
        { "$unwind": { "path": "$invoice_type_details", "preserveNullAndEmptyArrays": true } },
        {
            "$addFields": {
                "invoice_id": { "$toString": "$in_due_inv_id" }, 
                "invoice_number": "$invoice_details.in_list_number",
                "invoice_date": { "$toDate": "$invoice_details.in_list_datetime" },
                "invoice_desc": "$invoice_details.in_list_desc",
                "invoice_net": { "$ifNull": ["$invoice_details.in_list_net", 0] },
                "invoice_payment": { "$ifNull": ["$invoice_details.in_list_payment", 0] },
                "invoice_remind": "$invoice_details.in_list_remind",
                "customer_name": "$customer_details.cu_name",
                "customer_company": "$customer_details.cu_company",
                "customer_address": "$customer_details.cu_address",
                "customer_mobile1": "$customer_details.cu_mobile1",
                "customer_mobile2": "$customer_details.cu_mobile2",
                "customer_email": "$customer_details.cu_email",
                "agent_name": "$agent_details.ag_name",
                "currency_name": "$currency_details.cur_lst_name",
                "currency_id": "$currency_details.cur_lst_id",
                "invoice_type_name": "$invoice_type_details.in_type_name",
                "remaining_amount": {
                    "$divide": [
                        { "$subtract": ["$in_due_calc_net", "$in_due_calc_paid"] },
                        "$in_due_inv_curr_val"
                    ]
                },
                "due_days_remain": {
                    "$cond": {
                        "if": { "$eq": ["$invoice_details.in_list_remind", 0] },
                        "then": 0,
                        "else": {
                            "$add": [
                                { "$subtract": ["$invoice_details.in_list_remind", { "$dateDiff": { "startDate": { "$toDate": "$invoice_details.in_list_datetime" }, "endDate": "$$NOW", "unit": "day" } }] },
                                1
                            ]
                        }
                    }
                },
                "in_list_remind_date": {
                    "$cond": {
                        "if": { "$gt": ["$invoice_details.in_list_remind", 0] },
                        "then": { "$add": [{ "$toDate": "$invoice_details.in_list_datetime" }, { "$multiply": ["$invoice_details.in_list_remind", 86400000] }] },
                        "else": null
                    }
                }
            }
        },
        { "$match": { "remaining_amount": { "$gt": 0 } } }
    );

    return pipeline;
}

router.get('/invoices', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        const { page = 1, limit = 20 } = req.query;

        const pipeline = createDueInvoicesPipeline();
        const dueInvoices = await db.collection('tbl_invoice_due')
            .aggregate(pipeline)
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .toArray();

        const totalInvoices = await db.collection('tbl_invoice_due').countDocuments({ "in_due_calc_status": { "$ne": "مدفوع" } });

        res.json({ dueInvoices, totalInvoices });
    } catch (err) {
        console.error('Error fetching due invoices:', err.message);
        res.status(500).json({ error_msg: 'حدث خطأ أثناء استرجاع الفواتير المستحقة. يرجى المحاولة مرة أخرى لاحقاً.' });
    }
});

router.get('/', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);

        const pipeline = createDueInvoicesPipeline(); 
        const dueInvoices = await db.collection('tbl_invoice_due').aggregate(pipeline).toArray();

        const customers = dueInvoices.reduce((acc, invoice) => {
            const customerId = invoice.customer_name;
            if (!acc[customerId]) {
                acc[customerId] = {
                    name: invoice.customer_name,
                    company: invoice.customer_company,
                    address: invoice.customer_address,
                    mobile1: invoice.customer_mobile1,
                    mobile2: invoice.customer_mobile2,
                    email: invoice.customer_email,
                    debt: 0
                };
            }
            acc[customerId].debt += invoice.remaining_amount;
            return acc;
        }, {});

        res.json({ dueInvoices, customers: Object.values(customers) });
    } catch (err) {
        console.error('Error fetching due invoices:', err.message);
        res.status(500).json({ error_msg: 'حدث خطأ أثناء استرجاع الفواتير المستحقة. يرجى المحاولة مرة أخرى لاحقاً.' });
    }
});

router.get('/loadAll', ensureAuthenticated, async (req, res) => {
    try {
        const cacheKey = `due_invoices_${req.user._id}`; 
        if (cache.has(cacheKey)) {
            return res.json(cache.get(cacheKey));
        }

        const db = await getDatabase(req);

        const pipeline = createDueInvoicesPipeline(); 
        const dueInvoices = await db.collection('tbl_invoice_due').aggregate(pipeline).toArray();

        const customers = {};

        for (const invoice of dueInvoices) {
            const customerId = invoice.customer_name;
            if (!customers[customerId]) {
                const customerReminders = await calculateCustomerReminders(db, customerId);
                customers[customerId] = {
                    name: invoice.customer_name,
                    company: invoice.customer_company,
                    address: invoice.customer_address,
                    mobile1: invoice.customer_mobile1,
                    mobile2: invoice.customer_mobile2,
                    email: invoice.customer_email,
                    debt: 0,
                    reminders: customerReminders
                };
            }
            customers[customerId].debt += invoice.remaining_amount;
            invoice.reminderCount = await calculateInvoiceReminders(db, invoice.invoice_id);
        }

        const response = { dueInvoices, customers: Object.values(customers) };
        cache.set(cacheKey, response);
        res.json(response);
    } catch (err) {
        console.error('Error loading all due invoices:', err.message);
        res.status(500).json({ error: 'حدث خطأ أثناء استرجاع الفواتير المستحقة. يرجى المحاولة مرة أخرى لاحقاً.' });
    }
});

router.get('/customer/:name', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        const customerName = decodeURIComponent(req.params.name);

        const pipeline = createDueInvoicesPipeline(customerName);
        const dueInvoices = await db.collection('tbl_invoice_due').aggregate(pipeline).toArray();

        if (dueInvoices.length === 0) {
            const customerDetails = await db.collection('tbl_cust').findOne({ cu_name: customerName });

            if (!customerDetails) {
                res.status(404).json({ error: 'العميل غير موجود', customer: null, invoices: [] });
                return;
            }

            const customer = {
                name: customerDetails.cu_name,
                company: customerDetails.cu_company,
                address: customerDetails.cu_address,
                mobile1: customerDetails.cu_mobile1,
                mobile2: customerDetails.cu_mobile2,
                email: customerDetails.cu_email,
                balance: [],
                overdueInvoices: [],
                reminders: { totalReminders: 0, lastReminderDate: null }
            };

            res.json({ customer, invoices: [] });
            return;
        }

        const customerDetails = dueInvoices[0].customer_details;

        const customerBalance = await calculateCustomerBalance(db, customerDetails.cu_acc_id);

        const overdueInvoices = dueInvoices.reduce((acc, invoice) => {
            const currencyName = invoice.currency_name;
            if (!acc[currencyName]) {
                acc[currencyName] = { currency: currencyName, amount: 0 };
            }
            acc[currencyName].amount += parseFloat(invoice.remaining_amount.toFixed(2));
            return acc;
        }, {});

        Object.keys(overdueInvoices).forEach(currency => {
            overdueInvoices[currency].amount = parseFloat(overdueInvoices[currency].amount.toFixed(2));
        });

        const customerReminders = await calculateCustomerReminders(db, customerDetails.cu_name);

        const customer = {
            name: customerDetails.cu_name,
            company: customerDetails.cu_company,
            address: customerDetails.cu_address,
            mobile1: customerDetails.cu_mobile1,
            mobile2: customerDetails.cu_mobile2,
            email: customerDetails.cu_email,
            balance: customerBalance,
            overdueInvoices: Object.values(overdueInvoices),
            reminders: customerReminders
        };

        for (const invoice of dueInvoices) {
            invoice.reminderCount = await calculateInvoiceReminders(db, invoice.invoice_id);
        }

        res.json({ customer, invoices: dueInvoices });
    } catch (err) {
        console.error('Error while fetching customer details:', err.message);
        res.status(500).json({ error: 'حدث خطأ أثناء استرجاع تفاصيل العميل' });
    }
});


router.get('/reminders/:invoiceId', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        const invoiceId = req.params.invoiceId;
        const reminders = await getLastFiveReminders(db, invoiceId);
        res.json({ reminders });
    } catch (err) {
        console.error('Error while fetching reminders:', err.message);
        res.status(500).json({ error: 'حدث خطأ أثناء استرجاع بيانات التذكير' });
    }
});

router.get('/customers/names', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        const customers = await db.collection('tbl_cust').find({}, { projection: { cu_name: 1 } }).toArray();
        res.json(customers);
    } catch (err) {
        console.error('Error fetching customer names:', err.message);
        res.status(500).json({ error: 'حدث خطأ أثناء استرجاع أسماء العملاء' });
    }
});

module.exports = router;
