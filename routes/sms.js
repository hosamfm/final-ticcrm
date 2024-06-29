const express = require('express');
const router = express.Router();
const { sendNotification } = require('../utils/sendNotification');
const { ensureAuthenticated, getDatabase } = require('../utils/helpers');

const formatCurrency = (amount) => {
    const number = parseFloat(amount);
    if (isNaN(number)) {
        throw new Error('Invalid amount: ' + amount);
    }
    return number.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
};

router.post('/sendReminder', ensureAuthenticated, async (req, res) => {
    try {
        const { phone, customerName, invoices } = req.body;

        if (!phone || !customerName || !Array.isArray(invoices)) {
            return res.status(400).json({ error: 'رقم الهاتف، اسم العميل، والفواتير مطلوبة ويجب أن تكون الفواتير قائمة' });
        }

        const db = await getDatabase(req);
        const currentBalance = invoices.reduce((sum, invoice) => sum + parseFloat(invoice.remaining_amount), 0);
        const formattedCurrentBalance = formatCurrency(currentBalance);
        const currency = invoices[0]?.currency_name || '';

        // Format the invoice amounts
        const formattedInvoices = invoices.map(invoice => ({
            ...invoice,
            invoice_payment: formatCurrency(invoice.invoice_payment || 0),
            invoice_net: formatCurrency(invoice.invoice_net),
            remaining_amount: formatCurrency(invoice.remaining_amount)
        }));

        await sendNotification(db, 'sms', phone, customerName, formattedCurrentBalance, currency, formattedInvoices, req.user._id);
        res.json({ success: true, message: 'تم إرسال الرسالة عبر SMS بنجاح' });
    } catch (error) {
        console.error('Error sending SMS:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء إرسال الرسالة عبر SMS: ' + error.message });
    }
});

router.post('/sendWhatsAppReminder', ensureAuthenticated, async (req, res) => {
    try {
        const { phone, customerName, invoices } = req.body;

        if (!phone || !customerName || !Array.isArray(invoices)) {
            return res.status(400).json({ error: 'رقم الهاتف، اسم العميل، والفواتير مطلوبة ويجب أن تكون الفواتير قائمة' });
        }

        const db = await getDatabase(req);
        const currentBalance = invoices.reduce((sum, invoice) => sum + parseFloat(invoice.remaining_amount), 0);
        const formattedCurrentBalance = formatCurrency(currentBalance);
        const currency = invoices[0]?.currency_name || '';

        // Format the invoice amounts
        const formattedInvoices = invoices.map(invoice => ({
            ...invoice,
            invoice_payment: formatCurrency(invoice.invoice_payment || 0),
            invoice_net: formatCurrency(invoice.invoice_net),
            remaining_amount: formatCurrency(invoice.remaining_amount)
        }));

        await sendNotification(db, 'whatsapp', phone, customerName, formattedCurrentBalance, currency, formattedInvoices, req.user._id);
        res.json({ success: true, message: 'تم إرسال الرسالة عبر واتساب بنجاح' });
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء إرسال الرسالة عبر واتساب: ' + error.message });
    }
});

module.exports = router;
