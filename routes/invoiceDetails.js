const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const { ensureAuthenticated } = require('../utils/helpers');
const User = require('../models/User');

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

router.get('/:invoiceId', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        const invoiceId = BigInt(req.params.invoiceId);

        // جلب تفاصيل الفاتورة من جدول tbl_invoice_list
        const invoice = await db.collection('tbl_invoice_list').findOne({ in_list_id: invoiceId });
        if (!invoice) {
            return res.status(404).json({ error: 'لم يتم العثور على الفاتورة' });
        }

        // جلب تفاصيل العناصر من جدول tbl_invoice_det
        const invoiceDetails = await db.collection('tbl_invoice_det').find({ in_det_list_id: invoiceId }).toArray();
        if (invoiceDetails.length === 0) {
            return res.json([]);
        }

        const itemIds = invoiceDetails.map(detail => detail.in_det_item_id);
        const items = await db.collection('tbl_item').find({ it_id: { $in: itemIds } }).toArray();

        const currencyIds = invoiceDetails.map(detail => detail.in_det_currency_id);
        const currencies = await db.collection('tbl_currency').find({ cur_lst_id: { $in: currencyIds } }).toArray();

        const itemsMap = items.reduce((map, item) => {
            map[item.it_id] = item;
            return map;
        }, {});

        const currencyMap = currencies.reduce((map, currency) => {
            map[currency.cur_lst_id] = currency;
            return map;
        }, {});

        const detailedInvoice = invoiceDetails.map(detail => {
            const item = itemsMap[detail.in_det_item_id] || {};
            const currency = currencyMap[detail.in_det_currency_id] || {};
            const itemTotalValueInCurrency = detail.in_det_total_val * (currency.cur_lst_rate || 1);
            return {
                ...detail,
                itemName: item.it_name || '',
                itemPrice: detail.in_det_price,
                itemDiscount: detail.in_det_discount_val,
                itemTotalValue: detail.in_det_total_val,
                itemTotalValueInCurrency: itemTotalValueInCurrency,
                currencyName: currency.cur_lst_name || '',
                currencyRate: currency.cur_lst_rate || 1
            };
        });

        const response = {
            invoiceDetails: detailedInvoice,
            invoiceSummary: {
                invoiceId: invoice.in_list_id,
                invoiceNumber: invoice.in_list_number,
                invoiceDate: invoice.in_list_datetime,
                supplyDate: invoice.in_list_datetime_supply,
                totalAmount: invoice.in_list_total,
                discountValue: invoice.in_list_discount_val,
                netAmount: invoice.in_list_net,
                description: invoice.in_list_desc,
                customerName: invoice.in_list_cust_name,
                customerCell: invoice.in_list_cust_cell
            }
        };
        
        res.json(response);
    } catch (err) {
        console.error('Error fetching invoice details:', err.message);
        res.status(500).json({ error: 'حدث خطأ أثناء استرجاع تفاصيل الفاتورة' });
    }
});

router.get('/:invoiceId/pdf', ensureAuthenticated, async (req, res) => {
    try {
        const db = await getDatabase(req);
        const invoiceId = BigInt(req.params.invoiceId);

        // جلب تفاصيل الفاتورة من جدول tbl_invoice_list
        const invoice = await db.collection('tbl_invoice_list').findOne({ in_list_id: invoiceId });
        if (!invoice) {
            return res.status(404).json({ error: 'لم يتم العثور على الفاتورة' });
        }

        // جلب تفاصيل العناصر من جدول tbl_invoice_det
        const invoiceDetails = await db.collection('tbl_invoice_det').find({ in_det_list_id: invoiceId }).toArray();
        if (invoiceDetails.length === 0) {
            return res.status(404).json({ error: 'لم يتم العثور على تفاصيل الفاتورة' });
        }

        const itemIds = invoiceDetails.map(detail => detail.in_det_item_id);
        const items = await db.collection('tbl_item').find({ it_id: { $in: itemIds } }).toArray();

        const currencyIds = invoiceDetails.map(detail => detail.in_det_currency_id);
        const currencies = await db.collection('tbl_currency').find({ cur_lst_id: { $in: currencyIds } }).toArray();

        const itemsMap = items.reduce((map, item) => {
            map[item.it_id] = item;
            return map;
        }, {});

        const currencyMap = currencies.reduce((map, currency) => {
            map[currency.cur_lst_id] = currency;
            return map;
        }, {});

        const detailedInvoice = invoiceDetails.map(detail => {
            const item = itemsMap[detail.in_det_item_id] || {};
            const currency = currencyMap[detail.in_det_currency_id] || {};
            const itemTotalValueInCurrency = detail.in_det_total_val * (currency.cur_lst_rate || 1);
            return {
                ...detail,
                itemName: item.it_name || '',
                itemPrice: detail.in_det_price,
                itemDiscount: detail.in_det_discount_val,
                itemTotalValue: detail.in_det_total_val,
                itemTotalValueInCurrency: itemTotalValueInCurrency,
                currencyName: currency.cur_lst_name || '',
                currencyRate: currency.cur_lst_rate || 1
            };
        });

        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice_${invoiceId}.pdf`);

        doc.pipe(res);
        doc.fontSize(20).text('تفاصيل الفاتورة', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`رقم الفاتورة: ${invoice.in_list_number}`);
        doc.text(`تاريخ الفاتورة: ${invoice.in_list_datetime}`);
        doc.text(`تاريخ التوريد: ${invoice.in_list_datetime_supply}`);
        doc.text(`اسم العميل: ${invoice.in_list_cust_name}`);
        doc.text(`رقم هاتف العميل: ${invoice.in_list_cust_cell}`);
        doc.moveDown();

        doc.text('تفاصيل العناصر:');
        detailedInvoice.forEach(detail => {
            doc.text(`اسم الصنف: ${detail.itemName}`);
            doc.text(`الكمية: ${detail.in_det_qty}`);
            doc.text(`السعر: ${detail.itemPrice}`);
            doc.text(`الخصم: ${detail.itemDiscount}`);
            doc.text(`القيمة الإجمالية: ${detail.itemTotalValue}`);
            doc.text(`القيمة بعد التحويل: ${detail.itemTotalValueInCurrency}`);
            doc.text(`العملة: ${detail.currencyName}`);
            doc.moveDown();
        });

        doc.text(`المبلغ الإجمالي: ${invoice.in_list_total}`);
        doc.text(`الخصم الإجمالي: ${invoice.in_list_discount_val}`);
        doc.text(`المبلغ الصافي: ${invoice.in_list_net}`);

        doc.end();
    } catch (err) {
        console.error('Error generating PDF:', err.message);
        res.status(500).json({ error: 'حدث خطأ أثناء توليد ملف PDF' });
    }
});

module.exports = router;
