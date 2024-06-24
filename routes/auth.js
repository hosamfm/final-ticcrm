const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const passport = require('passport');
const User = require('../models/User');

// وسيط للتحقق من صلاحية الحساب
const checkAccountExpiration = async (req, res, next) => {
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user) {
        return res.status(401).json({ message: 'User not found' });
    }

    const currentDate = new Date();
    if (!user.accountExpirationDate || user.accountExpirationDate < currentDate) {
        return res.status(403).json({ message: 'Account has expired' });
    }

    next();
};

// معالجة التسجيل
router.post('/register', async (req, res) => {
    const { username, fullName, email, phoneNumber, password, password2, accountExpirationDate } = req.body;
    let errors = [];

    if (!username || !fullName || !email || !password || !password2) {
        errors.push({ msg: 'يرجى ملء جميع الحقول' });
    }

    if (password !== password2) {
        errors.push({ msg: 'كلمتا المرور غير متطابقتين' });
    }

    if (password.length < 6) {
        errors.push({ msg: 'يجب أن تكون كلمة المرور مكونة من 6 أحرف على الأقل' });
    }

    if (errors.length > 0) {
        return res.status(400).json({ errors });
    } else {
        try {
            const existingUser = await User.findOne({ $or: [{ username }, { email }] });
            if (existingUser) {
                errors.push({ 
                    msg: 'اسم المستخدم أو البريد الإلكتروني مسجل بالفعل. يمكنك تسجيل الدخول من <a href="/users/login">هنا</a>'
                });
                return res.status(400).json({ errors });
            }

            const newUser = new User({
                username,
                fullName,
                email,
                phoneNumber,
                password,
                role: 'no_permission',
                accountExpirationDate // إضافة تاريخ انتهاء الصلاحية
            });

            await newUser.save();
            return res.status(201).json({ msg: 'تم تسجيلك بنجاح ويمكنك الآن تسجيل الدخول' });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ errors: [{ msg: 'حدث خطأ، يرجى المحاولة مرة أخرى لاحقاً.' }] });
        }
    }
});

// معالجة تسجيل الدخول
router.post('/login', (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) {
            return res.status(500).json({ msg: 'Internal server error' });
        }
        if (!user) {
            return res.status(400).json({ msg: 'Invalid credentials' });
        }
        req.logIn(user, (err) => {
            if (err) {
                return res.status(500).json({ msg: 'Internal server error' });
            }
            return res.json({ user, msg: 'Login successful' });
        });
    })(req, res, next);
});

// التحقق من حالة تسجيل الدخول وإعادة تفاصيل المستخدم
router.get('/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ user: req.user });
    } else {
        res.status(401).json({ user: null });
    }
});

// تسجيل الخروج
router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        res.json({ msg: 'تم تسجيل خروجك بنجاح' });
    });
});

// إضافة دالة للتحقق من بيانات الشركة
router.get('/user/:companyId', async (req, res) => {
    try {
        const user = await User.findById(req.params.companyId).select('database');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        console.error('Error fetching company data:', error);
        res.status(500).json({ message: 'Error fetching company data' });
    }
});

// مسار محمي يستخدم وسيط التحقق من صلاحية الحساب
router.get('/protected', checkAccountExpiration, (req, res) => {
    res.send('This is a protected route.');
});

module.exports = router;
