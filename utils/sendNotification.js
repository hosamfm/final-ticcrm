const { sendSMS } = require('./sms');
const { sendWhatsAppMessage } = require('./whatsapp');

const formatCurrency = (amount) => {
    const number = parseFloat(amount);
    if (isNaN(number)) {
        throw new Error('Invalid amount: ' + amount);
    }
    return number.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
};

async function sendNotification(db, type, phone, customerName, currentBalance, currency, invoices, userId) {
    if (!Array.isArray(invoices)) {
        throw new Error('invoices يجب أن تكون قائمة');
    }

    // Format the balance
    const formattedCurrentBalance = formatCurrency(currentBalance);

    if (type === 'sms') {
        const message = `عزيزي ${customerName}, عليكم مستحقات بمبلغ ${formattedCurrentBalance} ${currency}. يرجى تسويتها في أسرع وقت ممكن لضمان استمرارية الخدمة. لأي استفسار، يرجى الاتصال على 0914567777 أو 0924567777.`;
        await sendSMS(db, phone, message, customerName, invoices, userId);
    } else if (type === 'whatsapp') {
        await sendWhatsAppMessage(db, phone, customerName, formattedCurrentBalance, currency, invoices, userId);
    } else {
        throw new Error('Invalid notification type');
    }
}

module.exports = { sendNotification };
