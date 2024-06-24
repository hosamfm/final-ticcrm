const express = require('express');
const router = express.Router();
const { sendNotification } = require('../utils/sendNotification');
const { ensureAuthenticated, getDatabase } = require('../utils/helpers');

router.post('/sendReminder', ensureAuthenticated, async (req, res) => {
    try {
        const { phone, customerName, invoices } = req.body;

        if (!phone || !customerName || !Array.isArray(invoices)) {
            return res.status(400).json({ error: 'رقم الهاتف، اسم العميل، والفواتير مطلوبة ويجب أن تكون الفواتير قائمة' });
        }

        const db = await getDatabase(req);
        const currentBalance = invoices.reduce((sum, invoice) => sum + invoice.remaining_amount, 0);
        const currency = invoices[0]?.currency_name || '';
        
        await sendNotification(db, 'sms', phone, customerName, currentBalance, currency, invoices, req.user._id);
        res.json({ success: true, message: 'تم إرسال الرسالة عبر SMS بنجاح' });
    } catch (error) {
        console.error('Error sending SMS:', error.message);
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
        const currentBalance = invoices.reduce((sum, invoice) => sum + invoice.remaining_amount, 0);
        const currency = invoices[0]?.currency_name || '';

        await sendNotification(db, 'whatsapp', phone, customerName, currentBalance, currency, invoices, req.user._id);
        res.json({ success: true, message: 'تم إرسال الرسالة عبر واتساب بنجاح' });
    } catch (error) {
        console.error('Error sending WhatsApp message:', error.message);
        res.status(500).json({ error: 'حدث خطأ أثناء إرسال الرسالة عبر واتساب: ' + error.message });
    }
});

module.exports = router;
