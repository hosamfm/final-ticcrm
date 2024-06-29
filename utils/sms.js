// utils/sms.js
const fetch = require('node-fetch');
const SentMessageSchema = require('../models/SentMessage').schema;
const SentInvoiceSchema = require('../models/SentInvoice').schema;

const formatCurrency = (amount) => {
    const number = parseFloat(amount);
    if (isNaN(number)) {
        throw new Error('Invalid amount: ' + amount);
    }
    return number.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
};

async function sendSMS(db, phone, message, customerName, invoices, userId) {
    try {
        const url = `https://semysms.net/api/3/sms.php?token=f372dcf103146b3e3cbbac95514b9cf1&device=active&phone=${phone}&msg=${encodeURIComponent(message)}`;

        const response = await fetch(url);
        if (!response.ok) {
            console.error('Failed to send SMS, response status:', response.status, response.statusText);
            throw new Error('Failed to send SMS, response status: ' + response.status + ' ' + response.statusText);
        }

        const result = await response.json();

        if (result.code !== '0') {
            let errorMsg = `Message sending failed, code: ${result.code}`;
            if (result.error) {
                errorMsg = result.error;
            }
            console.error('Error from SMS API:', result);
            throw new Error(errorMsg);
        }

        const SentMessage = db.model('SentMessage', SentMessageSchema);
        const sentMessage = new SentMessage({
            phone,
            message,
            customerName,
            sentBy: userId
        });

        await sentMessage.save();

        const SentInvoice = db.model('SentInvoice', SentInvoiceSchema);
        for (const invoice of invoices) {
            const sentInvoice = new SentInvoice({
                messageId: sentMessage._id,
                invoiceId: String(invoice.invoice_id),
                invoiceNumber: invoice.invoice_number,
                invoicePayment: formatCurrency(invoice.invoice_payment),
                invoiceNet: formatCurrency(invoice.invoice_net),
                remainingAmount: formatCurrency(invoice.remaining_amount),
                dueDaysRemain: invoice.due_days_remain
            });
            await sentInvoice.save();
        }

        return true;
    } catch (error) {
        console.error('Error in sendSMS:', error.message);
        throw error;
    }
}

module.exports = { sendSMS };
