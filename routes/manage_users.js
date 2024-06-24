const express = require('express');
const router = express.Router();
const User = require('../models/User');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// التأكد من أن المستخدم هو المدير أو المشرف
function ensureAdminOrSupervisorOrBusinessOwner(req, res, next) {
    if (req.isAuthenticated() && (req.user.role === 'admin' || req.user.role === 'supervisor' || req.user.role === 'business_owner')) {
        return next();
    }
    res.status(401).json({ error_msg: 'You are not authorized to view this page' });
}

// التأكد من أن المستخدم هو المدير أو المشرف فقط
function ensureAdminOrSupervisor(req, res, next) {
    if (req.isAuthenticated() && (req.user.role === 'admin' || req.user.role === 'supervisor')) {
        return next();
    }
    res.status(401).json({ error_msg: 'You are not authorized to view this page' });
}

// التأكد من أن المستخدم هو المدير فقط
function ensureAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user.role === 'admin') {
        return next();
    }
    res.status(401).json({ error_msg: 'You are not authorized to view this page' });
}

// جلب أسماء قواعد البيانات التي تبدأ بالحرفين R و X
async function getDatabaseNames() {
    const adminDb = mongoose.connection.db.admin();
    const { databases } = await adminDb.listDatabases();
    return databases
        .map(db => db.name)
        .filter(name => name.startsWith('X') || name.startsWith('R'));
}

// صفحة إدارة المستخدمين
router.get('/', ensureAdminOrSupervisorOrBusinessOwner, async (req, res) => {
    try {
        let users;
        if (req.user.role === 'business_owner') {
            users = await User.find({ company: req.user._id });
        } else {
            users = await User.find();
        }
        const databaseNames = await getDatabaseNames();
        const companyUsers = await User.find({ role: 'business_owner' });
        res.json({ users, userRole: req.user.role, databaseNames, companyUsers });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error_msg: 'An error occurred while fetching data' });
    }
});

// تعديل صلاحيات المستخدم
router.post('/updateUser', ensureAdminOrSupervisor, async (req, res) => {
    const { userId, role, database, company, accountExpirationDate } = req.body;
    try {
        const updateData = { role };

        // تحديث قاعدة البيانات بناءً على دور المستخدم
        if (role === 'business_owner') {
            updateData.database = database;
            updateData.company = null; // تأكد من عدم تعيين الشركة لصاحب العمل
        } else if (role === 'employee') {
            updateData.company = company;
            updateData.database = null; // تأكد من عدم تعيين قاعدة البيانات للموظف
        } else {
            updateData.database = database; // تعيين قاعدة البيانات للأدوار الأخرى
            updateData.company = null; // تأكد من عدم تعيين الشركة للأدوار الأخرى
        }

        // تحديث تاريخ انتهاء الصلاحية إذا تم توفيره
        if (accountExpirationDate) {
            updateData.accountExpirationDate = new Date(accountExpirationDate);
        } else {
            updateData.accountExpirationDate = null;
        }

        await User.findByIdAndUpdate(userId, updateData);
        res.json({ success_msg: 'User updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error_msg: 'An error occurred while updating user' });
    }
});


// تغيير كلمة المرور
router.post('/changePassword', ensureAdminOrSupervisorOrBusinessOwner, async (req, res) => {
    const { userId, newPassword, confirmPassword } = req.body;
    try {
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ error_msg: 'Passwords do not match' });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        await User.findByIdAndUpdate(userId, { password: hashedPassword });
        res.json({ success_msg: 'Password changed successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error_msg: 'An error occurred while changing password' });
    }
});

// حذف المستخدم
router.post('/delete', ensureAdmin, async (req, res) => {
    const { userId } = req.body;
    try {
        await User.findByIdAndDelete(userId);
        res.json({ success_msg: 'User deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error_msg: 'An error occurred while deleting user' });
    }
});

module.exports = router;
