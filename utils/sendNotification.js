const { sendSMS } = require('./sms');
const { sendWhatsAppMessage } = require('./whatsapp');

async function sendNotification(db, type, phone, customerName, currentBalance, currency, invoices, userId) {
    if (!Array.isArray(invoices)) {
        throw new Error('invoices يجب أن تكون قائمة');
    }
    
    if (type === 'sms') {
        const message = `عزيزي ${customerName}, عليكم مستحقات بمبلغ ${currentBalance} ${currency}. يرجى تسويتها في أسرع وقت ممكن لضمان استمرارية الخدمة. لأي استفسار، يرجى الاتصال على 0914567777 أو 0924567777.`;
        await sendSMS(db, phone, message, customerName, invoices, userId);
    } else if (type === 'whatsapp') {
        await sendWhatsAppMessage(db, phone, customerName, currentBalance, currency, invoices, userId);
    } else {
        throw new Error('Invalid notification type');
    }
}

module.exports = { sendNotification };
