const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['no_permission', 'employee', 'business_owner', 'admin', 'supervisor'], default: 'no_permission' },  // الأدوار المحددة
    permissions: [{ type: String }],  // إضافة حقل الصلاحيات
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // صاحب العمل الذي ينتمي إليه الموظف
    database: { type: String }, // اسم قاعدة البيانات المرتبطة
    fullName: { type: String }, // الاسم الكامل
    email: { type: String, unique: true, required: true }, // البريد الإلكتروني
    phoneNumber: { type: String }, // رقم الهاتف
    companyName: { type: String }, // اسم الشركة
    country: { type: String }, // الدولة
    city: { type: String }, // المدينة
    address: { type: String }, // العنوان
    status: { type: String, default: 'active' }, // الحالة (نشط/معطل)
    lastLogin: { type: Date }, // تاريخ آخر تسجيل دخول
    createdAt: { type: Date, default: Date.now }, // تاريخ الإنشاء
    updatedAt: { type: Date, default: Date.now }, // تاريخ التحديث
    accountExpirationDate: { type: Date } // تاريخ انتهاء صلاحية الحساب
});

// تشفير كلمة المرور قبل الحفظ
UserSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    this.updatedAt = Date.now(); // تحديث تاريخ التحديث في كل مرة يتم فيها الحفظ
    next();
});

const User = mongoose.model('User', UserSchema);

module.exports = User;
