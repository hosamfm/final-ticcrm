const mongoose = require('mongoose');
const User = require('../models/User'); // تأكد من وجود النموذج

/**
 * استخدم قاعدة البيانات الخاصة بالمستخدم بناءً على دوره
 * @param {Object} req - كائن الطلب
 * @returns {Object} - اتصال قاعدة البيانات المناسبة
 */
async function getDatabase(req) {
    try {
        if (!req.user || !req.user.role) {
            throw new Error('User or user role is not defined');
        }

        let databaseName;
        if (req.user.role === 'employee') {
            const employer = await User.findById(req.user.company);
            if (!employer) {
                throw new Error('Employer not found for the employee');
            }
            databaseName = employer.database;
        } else {
            databaseName = req.user.database;
        }

        if (!databaseName) {
            throw new Error('Database name is not defined for this user');
        }

        const db = mongoose.connection.useDb(databaseName);
        return db;
    } catch (error) {
        console.error('Error getting database:', error.message);
        throw error; // إعادة رمي الاستثناء لمعالجته في مكان آخر
    }
}

/**
 * إنشاء عملية تجميع لاسترجاع الفواتير المستحقة
 * @param {String} customerName - اسم العميل (اختياري)
 * @returns {Array} - خط التجميع
 */
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
                "localField": "invoice_details.in_list_acc_cust", 
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
                "invoice_id": { "$toString": "$in_due_inv_id" }, // تحويل invoice_id إلى سلسلة نصية
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

/**
 * التحقق من تسجيل الدخول
 * @param {Object} req - كائن الطلب
 * @param {Object} res - كائن الاستجابة
 * @param {Function} next - الدالة التالية
 */
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    req.flash('error_msg', 'الرجاء تسجيل الدخول لعرض هذه الصفحة');
    res.redirect('/users/login');
}

module.exports = { getDatabase, createDueInvoicesPipeline, ensureAuthenticated };
