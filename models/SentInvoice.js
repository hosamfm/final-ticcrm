// models/SentInvoice.js
const mongoose = require('mongoose');

const SentInvoiceSchema = new mongoose.Schema({
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'SentMessage', required: true },
    invoiceId: { type: String, required: true },
    invoiceNumber: { type: String, required: true },
    invoicePayment: { type: Number, required: true },
    invoiceNet: { type: Number, required: true },
    remainingAmount: { type: Number, required: true },
    dueDaysRemain: { type: Number, required: true }
});

module.exports = mongoose.model('SentInvoice', SentInvoiceSchema);
