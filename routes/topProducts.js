const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../utils/helpers');
const mongoose = require('mongoose');
const User = require('../models/User');
const cache = require('memory-cache');

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

    const dbConnection = mongoose.connection.useDb(databaseName);

    // Ensure indexes are created
    await ensureIndexes(dbConnection);

    return dbConnection;
}

async function ensureIndexes(dbConnection) {
    const invoiceDetCollection = dbConnection.collection('tbl_invoice_det');
    const invoiceListCollection = dbConnection.collection('tbl_invoice_list');
    const itemCollection = dbConnection.collection('tbl_item');

    // Create indexes if they do not exist
    await invoiceDetCollection.createIndex({ in_det_list_id: 1 });
    await invoiceListCollection.createIndex({ in_list_id: 1 });
    await invoiceListCollection.createIndex({ in_list_datetime: 1 });
    await invoiceDetCollection.createIndex({ in_det_item_id: 1 });
    await itemCollection.createIndex({ it_id: 1 });
}

router.get('/', ensureAuthenticated, async (req, res) => {
    const cachedData = cache.get('top-products-month');
    if (cachedData) {
        return res.json(cachedData);
    }
    try {
        const db = await getDatabase(req);

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
        const topProducts = await db.collection('tbl_invoice_det').aggregate([
            {
                $lookup: {
                    from: 'tbl_invoice_list',
                    localField: 'in_det_list_id',
                    foreignField: 'in_list_id',
                    as: 'invoice'
                }
            },
            { $unwind: "$invoice" },
            {
                $match: {
                    'invoice.in_list_datetime': { $gte: startDate.toISOString().slice(0, 19), $lte: endDate.toISOString().slice(0, 19) }
                }
            },
            {
                $lookup: {
                    from: 'tbl_item',
                    localField: 'in_det_item_id',
                    foreignField: 'it_id',
                    as: 'item'
                }
            },
            { $unwind: "$item" },
            {
                $group: {
                    _id: "$item.it_name",
                    total: { $sum: "$in_det_total_val" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { total: -1 } },
            { $limit: 3 }
        ]).toArray();
        if (topProducts.length === 0) {
        }

        cache.put('top-products-month', topProducts, 60000); // Cache for 60 seconds

        res.json(topProducts);
    } catch (err) {
        console.error('Error fetching top products:', err.message);
        res.status(500).json({ error: 'حدث خطأ أثناء استرجاع الأصناف الأكثر مبيعاً.' });
    }
});

module.exports = router;
