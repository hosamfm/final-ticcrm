const express = require('express');
const router = express.Router();
const { ensureAuthenticated, getDatabase } = require('../utils/helpers');
const mongoose = require('mongoose');
const User = require('../models/User');
const Long = require('mongodb').Long;
const createAccountBalanceModel = require('../models/AccountBalance');

mongoose.connect(process.env.DATABASE_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));

const initializeAccountBalances = async (db) => {
    const AccountBalance = createAccountBalanceModel(db);

    const balances = await db.collection('tbl_gl').aggregate([
        {
            $group: {
                _id: { account_id: '$gl_ac_id', currency_id: '$gl_currency_id' },
                balance: { $sum: { $subtract: ['$gl_debit', '$gl_credit'] } },
                last_gl_id: { $max: '$_id' }
            }
        }
    ]).toArray();

    for (const balance of balances) {
        await AccountBalance.updateOne(
            { account_id: balance._id.account_id, currency_id: balance._id.currency_id },
            {
                $set: {
                    balance: balance.balance,
                    last_gl_id: balance.last_gl_id,
                    last_updated: new Date()
                }
            },
            { upsert: true }
        );
    }
};

const updateAccountBalances = async (db) => {
    const AccountBalance = createAccountBalanceModel(db);

    let collections = await db.db.listCollections({ name: 'accountbalances' }).toArray();
    if (collections.length === 0) {
        console.log('Collection accountbalances does not exist. Initializing balances...');
        await initializeAccountBalances(db);

        await new Promise(resolve => setTimeout(resolve, 1000));
        collections = await db.db.listCollections({ name: 'accountbalances' }).toArray();

        if (collections.length === 0) {
            console.error('Collection accountbalances still does not exist after initialization.');
            return;
        }
    }

    const accountBalancesCount = await AccountBalance.countDocuments().exec();
    if (accountBalancesCount === 0) {
        console.log('No records found in accountbalances collection. Initializing balances...');
        await initializeAccountBalances(db);
    }

    const lastProcessedTransaction = await AccountBalance.findOne().sort({ last_gl_id: -1 }).exec();
    const lastGlId = lastProcessedTransaction ? lastProcessedTransaction.last_gl_id : null;

    const newTransactions = await db.collection('tbl_gl').find({
        _id: { $gt: lastGlId } // تحقق من المعاملات الجديدة
    }).toArray();

    if (newTransactions.length > 0) {
        const transactionsByAccount = newTransactions.reduce((acc, transaction) => {
            const key = `${transaction.gl_ac_id}_${transaction.gl_currency_id}`;
            if (!acc[key]) {
                acc[key] = {
                    account_id: transaction.gl_ac_id,
                    currency_id: transaction.gl_currency_id,
                    balanceChange: 0,
                    last_gl_id: transaction._id
                };
            }
            acc[key].balanceChange += (transaction.gl_debit - transaction.gl_credit);
            acc[key].last_gl_id = transaction._id;
            return acc;
        }, {});

        let totalBalanceChange = 0;
        let lastUpdatedAccount = null;

        for (const key in transactionsByAccount) {
            const { account_id, currency_id, balanceChange, last_gl_id } = transactionsByAccount[key];
            totalBalanceChange += balanceChange;
            lastUpdatedAccount = { account_id, currency_id, last_gl_id };

            await AccountBalance.updateOne(
                { account_id, currency_id },
                {
                    $inc: { balance: balanceChange },
                    $set: { last_gl_id, last_updated: new Date() }
                }
            );
        }

        if (lastUpdatedAccount) {
            console.log(`Last updated account: ${JSON.stringify(lastUpdatedAccount)}`);
        }
    } else {
        console.log('No new transactions found.');
    }
};

// مسار لمعرفة الرصيد الإجمالي لكل حساب بعملة معينة أو بجميع العملات
router.get('/balance/:account_id?/:currency_id?', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        const AccountBalance = createAccountBalanceModel(db);
        const account_id = req.params.account_id ? Long.fromString(req.params.account_id) : null;
        const currency_id = req.params.currency_id ? parseInt(req.params.currency_id, 10) : null;

        let query = {};
        if (account_id !== null) {
            query.account_id = account_id;
        }
        if (currency_id !== null) {
            query.currency_id = currency_id;
        }

        const accountBalances = await AccountBalance.find(query).exec();

        if (accountBalances.length > 0) {
            const balances = await Promise.all(accountBalances.map(async (acc) => {
                const currency = await db.collection('tbl_currency').findOne({ cur_lst_id: acc.currency_id });
                const account = await db.collection('tbl_account').findOne({ ac_id: acc.account_id });

                return {
                    account_id: acc.account_id.toString(),
                    account_name: account ? account.ac_name : 'Unknown',
                    currency_id: acc.currency_id,
                    currency_code: currency ? currency.cur_lst_code : 'Unknown',
                    balance: acc.balance,
                    last_updated: acc.last_updated
                };
            }));
            res.json({ balances });
        } else {
            res.status(404).json({ error: 'Account balances not found' });
        }
    } catch (error) {
        console.error('Error fetching account balance:', error);
        res.status(500).json({ error: 'Error fetching account balance' });
    }
});

router.post('/initialize-balances', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        await initializeAccountBalances(db);
        res.json({ message: 'Account balances initialized successfully.' });
    } catch (error) {
        console.error('Error initializing account balances:', error);
        res.status(500).json({ error: 'Error initializing account balances' });
    }
});

router.post('/update-balances', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        await updateAccountBalances(db);
        res.json({ message: 'Account balances updated successfully.' });
    } catch (error) {
        console.error('Error updating account balances:', error);
        res.status(500).json({ error: 'Error updating account balances' });
    }
});

module.exports = router;
