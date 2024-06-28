const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../utils/helpers');
const mongoose = require('mongoose');
const User = require('../models/User');
const Long = require('mongodb').Long;
const redis = require('redis');

// إعداد اتصال Redis
const client = redis.createClient();

client.on('error', (err) => console.error('Redis client error', err));

client.connect();

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

const updateXDueInv = async (db, p_acc_id, v_customer_balance) => {

    // جلب الفواتير غير المدفوعة وترتيبها حسب التاريخ من الأقدم إلى الأحدث
    const invoices = await db.collection('tbl_invoice_due').find({
        in_due_inv_acc_id: Long.fromString(p_acc_id),
        in_due_inv_return_id: 0
    }).sort({ in_due_inv_datetime: 1 }).toArray();

    let remaining_balance = v_customer_balance;

    // توزيع الرصيد المدفوع على الفواتير
    for (const invoice of invoices) {
        const invoice_net = invoice.in_due_inv_net;
        const payment_to_apply = Math.min(remaining_balance, invoice_net);

        await db.collection('tbl_invoice_due').updateOne(
            { _id: invoice._id },
            {
                $set: {
                    in_due_calc_paid: payment_to_apply
                }
            }
        );

        remaining_balance -= payment_to_apply;

        if (remaining_balance <= 0) {
            break;
        }
    }
};

const getDueInvoices = async (db, p_acc_id) => {
    const accountId = Long.fromString(p_acc_id);

    // حساب إجمالي المبلغ المستحق للفواتير غير المدفوعة
    const invoiceReturn = await db.collection('tbl_invoice_due').aggregate([
        {
            $match: {
                in_due_inv_acc_id: accountId,
                in_due_inv_return_id: 0,
                in_due_inv_const: 104
            }
        },
        {
            $group: {
                _id: '$in_due_inv_acc_id',
                total: {
                    $sum: {
                        $cond: [
                            { $eq: ['$in_due_inv_curr_id', 1] },
                            { $subtract: ['$in_due_inv_net', { $add: ['$in_due_inv_payment', '$in_due_inv_payments'] }] },
                            {
                                $multiply: [
                                    {
                                        $cond: [
                                            { $eq: ['@CURR_TYPE', 0] },
                                            {
                                                $divide: [
                                                    { $subtract: ['$in_due_inv_net', { $add: ['$in_due_inv_payment', '$in_due_inv_payments'] }] },
                                                    { $ifNull: ['$in_due_inv_curr_val', 1] }
                                                ]
                                            },
                                            {
                                                $multiply: [
                                                    { $subtract: ['$in_due_inv_net', { $add: ['$in_due_inv_payment', '$in_due_inv_payments'] }] },
                                                    { $ifNull: ['$in_due_inv_curr_val', 1] }
                                                ]
                                            }
                                        ]
                                    },
                                    1
                                ]
                            }
                        ]
                    }
                }
            }
        }
    ]).toArray();
    
    const invoice_return_total = invoiceReturn.length > 0 ? invoiceReturn[0].total : 0;

    // تحديث الفواتير لتعيين القيم المدفوعة إلى الصفر
    await db.collection('tbl_invoice_due').updateMany(
        { in_due_inv_acc_id: accountId },
        {
            $set: {
                in_due_calc_net: 0,
                in_due_calc_payment: 0,
                in_due_calc_paid: 0,
                in_due_calc_status: 0
            }
        }
    );

    // جلب الفواتير بعد إعادة التعيين
    await db.collection('tbl_invoice_due').find({ in_due_inv_acc_id: accountId }).toArray();

    // حساب إجمالي الدائن والمدين من جدول القيود العامة
    const glSums = await db.collection('tbl_gl').aggregate([
        {
            $match: {
                gl_ac_id: accountId,
                gl_init: 0,
                gl_const: { $in: [0, 1, 2, 3, 10, 11, 48, 49, 84, 85] },
                gl_batch_id: { $nin: await db.collection('tbl_invoice_payment').distinct('in_pay_batch_id') }
            }
        },
        {
            $group: {
                _id: null,
                gl_credit_sum: { $sum: { $divide: [{ $ifNull: ['$gl_credit', 0] }, { $ifNull: ['$gl_currency_val', 1] }] } },
                gl_debit_sum: { $sum: { $divide: [{ $ifNull: ['$gl_debit', 0] }, { $ifNull: ['$gl_currency_val', 1] }] } }
            }
        }
    ]).toArray();

    // حساب الرصيد النهائي للعميل
    const gl_credit_sum = glSums.length > 0 ? glSums[0].gl_credit_sum : 0;
    const gl_debit_sum = glSums.length > 0 ? glSums[0].gl_debit_sum : 0;

    const v_customer_balance = (gl_credit_sum) - (gl_debit_sum) + invoice_return_total;

    // استدعاء إجراء مخزن لتحديث الفواتير المستحقة
    await updateXDueInv(db, p_acc_id, v_customer_balance);

    // الحصول على الفواتير المستحقة بالتفاصيل المطلوبة
    const dueInvoices = await db.collection('tbl_invoice_due').aggregate([
        {
            $match: {
                in_due_inv_acc_id: accountId
            }
        },
        {
            $lookup: {
                from: 'tbl_invoice_list',
                localField: 'in_due_inv_id',
                foreignField: 'in_list_id',
                as: 'invoice_details'
            }
        },
        {
            $unwind: '$invoice_details'
        },
        {
            $lookup: {
                from: 'tbl_invoice_type',
                localField: 'invoice_details.in_list_type_id',
                foreignField: 'in_type_id',
                as: 'type_details'
            }
        },
        {
            $unwind: { path: '$type_details', preserveNullAndEmptyArrays: true }
        },
        {
            $lookup: {
                from: 'tbl_gl',
                localField: 'invoice_details.in_list_acc_cust',
                foreignField: 'gl_ac_id',
                as: 'gl_details'
            }
        },
        {
            $unwind: { path: '$gl_details', preserveNullAndEmptyArrays: true }
        },
        {
            $lookup: {
                from: 'tbl_cust',
                localField: 'invoice_details.in_list_acc_cust',
                foreignField: 'cu_acc_id',
                as: 'customer_details'
            }
        },
        {
            $unwind: '$customer_details'
        },
        {
            $lookup: {
                from: 'tbl_currency',
                localField: 'invoice_details.in_list_currency_id',
                foreignField: 'cur_lst_id',
                as: 'currency_details'
            }
        },
        {
            $unwind: '$currency_details'
        },
        {
            $lookup: {
                from: 'tbl_agent',
                localField: 'invoice_details.in_list_agent_id',
                foreignField: 'ag_id',
                as: 'agent_details'
            }
        },
        {
            $unwind: { path: '$agent_details', preserveNullAndEmptyArrays: true }
        },
        {
            $addFields: {
                'invoice_details.in_list_datetime': {
                    $dateFromString: {
                        dateString: '$invoice_details.in_list_datetime'
                    }
                },
                total_payment: { $sum: { $add: ['$in_due_calc_paid', '$in_due_calc_payment'] } },
                invoice_type_name: '$type_details.in_type_name',
                invoice_desc: '$invoice_details.in_list_desc',
                currency_name: '$currency_details.cur_lst_name',
                agent_name: '$agent_details.ag_name',
                p_acc_id: p_acc_id // Adding p_acc_id to each invoice
            }
        },
        {
            $match: {
                'invoice_details.in_list_old_year': 0,
                'invoice_details.in_list_type_const': 102,
                'invoice_details.in_list_payment_type': { $in: [2, 3] },
                'invoice_details.in_list_remind': { $gt: 0 },
                $expr: {
                    $lte: [
                        { $add: ['$invoice_details.in_list_datetime', { $multiply: ['$invoice_details.in_list_remind', 86400000] }] },
                        new Date()
                    ]
                }
            }
        },
        {
            $group: {
                _id: '$in_due_inv_id',
                in_list_id: { $first: '$invoice_details.in_list_id' },
                in_list_number: { $first: '$invoice_details.in_list_number' },
                in_list_datetime: { $first: '$invoice_details.in_list_datetime' },
                in_list_net: { $first: '$invoice_details.in_list_net' },
                in_list_payment: { $first: '$total_payment' },
                in_list_remain: { $first: { $subtract: ['$invoice_details.in_list_net', '$total_payment'] } },
                in_list_remind: { $first: '$invoice_details.in_list_remind' },
                total_payments: { $sum: { $ifNull: ['$gl_details.gl_credit', 0] } },
                due_days_remain: {
                    $first: {
                        $cond: [
                            { $gt: ['$invoice_details.in_list_remind', 0] },
                            {
                                $subtract: [
                                    '$invoice_details.in_list_remind',
                                    { $divide: [{ $subtract: [new Date(), '$invoice_details.in_list_datetime'] }, 86400000] }
                                ]
                            },
                            0
                        ]
                    }
                },
                customer_name: { $first: '$customer_details.cu_name' },
                cu_id: { $first: '$customer_details.cu_id' }, // Extracting the correct cu_id from customer_details
                in_list_acc_cust: { $first: '$invoice_details.in_list_acc_cust' },
                invoice_type_name: { $first: '$invoice_type_name' },
                invoice_desc: { $first: '$invoice_desc' },
                currency_name: { $first: '$currency_name' },
                agent_name: { $first: '$agent_name' },
                p_acc_id: { $first: '$p_acc_id' } // Grouping p_acc_id
            }
        },
        {
            $match: {
                in_list_remain: { $gt: 0 } // استبعاد الفواتير التي تم دفعها بالكامل أو أكثر
            }
        },
        {
            $sort: { in_list_datetime: 1 }
        }
    ]).toArray();

    // تحويل القيم من Long إلى سلاسل نصية لضمان الدقة
    const dueInvoicesConverted = dueInvoices.map(invoice => {
        return {
            ...invoice,
            _id: longToString(invoice._id),
            in_list_id: longToString(invoice.in_list_id),
            cu_id: longToString(invoice.cu_id),
            in_list_acc_cust: longToString(invoice.in_list_acc_cust)
        };
    });

    return dueInvoicesConverted;
};

const longToString = (long) => {
    if (Long.isLong(long)) {
        return long.toString();
    }
    return long;
};

const longToInt = (long) => {
    if (long && typeof long === 'object' && long.low !== undefined && long.high !== undefined) {
        return long.toNumber();
    }
    return long;
};

const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
};

// Middleware للتحقق من التخزين المؤقت
async function cacheMiddleware(req, res, next) {
    const p_acc_id = req.query.p_acc_id || 'all';
    const cacheKey = `due_invoices_${p_acc_id}`;

    try {
        const cachedData = await client.get(cacheKey);
        if (cachedData) {
            return res.json(JSON.parse(cachedData));
        }
        req.cacheKey = cacheKey;
        next();
    } catch (err) {
        console.error('Redis cache error:', err);
        next();
    }
}

// مسار للحصول على الفواتير المستحقة مع استخدام التخزين المؤقت
router.get('/due-invoices', ensureAuthenticated, cacheMiddleware, async (req, res) => {
    try {
        const db = await getDatabase(req);

        let dueInvoices = [];
        if (!req.query.p_acc_id) {
            // الحصول على جميع الحسابات التي تحتوي على الفواتير المستحقة بالشروط المحددة
            const accounts = await db.collection('tbl_invoice_due').distinct('in_due_inv_acc_id', {
                in_due_inv_const: 102,
                $expr: {
                    $gte: [{ $subtract: ['$in_due_inv_net', '$in_due_calc_paid'] }, 1]
                }
            });
            // استخدام Promise.all لتنفيذ الاستعلامات بشكل متوازي
            const invoicePromises = accounts.map(accountId => getDueInvoices(db, accountId.toString()));
            dueInvoices = (await Promise.all(invoicePromises)).flat();
        } else {
            // إذا تم تمرير معرف الحساب
            dueInvoices = await getDueInvoices(db, req.query.p_acc_id);
        }

        // تحويل قيم Long إلى أعداد صحيحة عادية وتنسيق القيم المالية وتحديد القيم الصحيحة
        dueInvoices = dueInvoices.map(invoice => {
            return {
                ...invoice,
                _id: longToInt(invoice._id),
                in_list_id: longToInt(invoice.in_list_id),
                cu_id: longToInt(invoice.cu_id),
                in_list_acc_cust: longToInt(invoice.in_list_acc_cust),
                in_list_net: formatCurrency(invoice.in_list_net),
                in_list_payment: formatCurrency(invoice.in_list_payment),
                in_list_remain: formatCurrency(invoice.in_list_remain),
                due_days_remain: Math.round(invoice.due_days_remain)
            };
        });

        // تخزين البيانات في Redis
        await client.set(req.cacheKey, JSON.stringify(dueInvoices), 'EX', 3600); // تخزين البيانات لمدة ساعة واحدة

        res.json(dueInvoices);
    } catch (err) {
        console.error('Error fetching due invoices:', err.message);
        res.status(500).json({ error_msg: 'Error fetching due invoices' });
    }
});

router.get('/customer/:p_acc_id', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        const p_acc_id = BigInt(req.params.p_acc_id);

        const customerDetails = await db.collection('tbl_cust').findOne({ cu_acc_id: p_acc_id });

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
    } catch (err) {
        console.error('Error while fetching customer details:', err.message);
        res.status(500).json({ error: 'حدث خطأ أثناء استرجاع تفاصيل العميل' });
    }
});

module.exports = router;
