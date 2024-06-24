const express = require('express');
const router = express.Router();
const User = require('../models/User');

// التأكد من أن المستخدم هو صاحب عمل
function ensureBusinessOwner(req, res, next) {
    if (req.isAuthenticated() && req.user.role === 'business_owner') {
        return next();
    }
    req.flash('error_msg', 'You are not authorized to view this page');
    res.redirect('/users/login');
}

// صفحة إدارة المستخدمين الخاصة بصاحب العمل
router.get('/', ensureBusinessOwner, async (req, res) => {
    const users = await User.find({ company: req.user._id });
    res.render('company', { users });
});

// إنشاء موظف جديد
router.post('/addEmployee', ensureBusinessOwner, async (req, res) => {
    const { username, password } = req.body;
    try {
        const newUser = new User({
            username,
            password,
            role: 'employee',
            company: req.user._id,
            database: req.user.database
        });
        await newUser.save();
        req.flash('success_msg', 'Employee added successfully');
        res.redirect('/company');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while adding employee');
        res.redirect('/company');
    }
});

module.exports = router;
