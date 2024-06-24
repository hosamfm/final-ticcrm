// models/SentMessage.js
const mongoose = require('mongoose');

const SentMessageSchema = new mongoose.Schema({
    phone: { type: String, required: true },
    message: { type: String, required: true },
    customerName: { type: String, required: true },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sendDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SentMessage', SentMessageSchema);
