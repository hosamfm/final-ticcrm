const mongoose = require('mongoose');
require('mongoose-long')(mongoose); // استيراد mongoose-long
const Schema = mongoose.Schema;
const Types = mongoose.Types;

const accountBalanceSchema = new Schema({
    account_id: {
        type: Types.Long, // استخدام النوع Long
        required: true
    },
    currency_id: {
        type: Number,
        required: true
    },
    balance: {
        type: Number,
        required: true
    },
    last_gl_id: {
        type: Types.ObjectId, // استخدام النوع ObjectId
        required: true
    },
    last_updated: {
        type: Date,
        default: Date.now
    }
});

const createAccountBalanceModel = (db) => {
    return db.model('AccountBalance', accountBalanceSchema);
};

module.exports = createAccountBalanceModel;
