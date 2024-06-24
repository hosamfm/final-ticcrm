const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const flash = require('connect-flash');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const dashboardRouter = require('./routes/dashboard');
const User = require('./models/User');
require('dotenv').config();

const app = express();

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "'unsafe-inline'"],
            connectSrc: ["'self'", "https://cdnjs.cloudflare.com"]
        },
    },
}));

app.use(express.static('public'));
app.use(express.static(path.join(__dirname, 'build')));

mongoose.connect(process.env.DATABASE_URL)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log(err));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const allowedOrigins = [process.env.FRONTEND_URL || 'http://localhost:3000'];

app.use(cors({
    origin: function (origin, callback) {
        // Check if the incoming origin is allowed
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true
}));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.DATABASE_URL }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // عمر الكوكيز يوم واحد
        httpOnly: true,
        secure: false, // تأكد من أن هذا يتوافق مع إعدادات البيئة الخاصة بك (HTTPS)
        sameSite: 'Lax' // تأكد من أن نفس الموقع يتم تعيينه بشكل صحيح
    }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error');
    res.locals.user = req.user || null;
    next();
});

require('./config/passport')(passport);

// إعداد مسارات الواجهة الخلفية
const usersRouter = require('./routes/auth');
const manageUsersRouter = require('./routes/manage_users');
const companyRouter = require('./routes/company');
const customerRouter = require('./routes/customers');
const dueInvoicesRouter = require('./routes/due_invoices');
const smsRouter = require('./routes/sms');
const apiRouter = require('./routes/api');
const invoiceDetailsRouter = require('./routes/invoiceDetails');
const topProductsRouter = require('./routes/topProducts'); // إضافة هذا السطر

// مسارات المستخدمين
app.use('/api/auth', usersRouter);
app.use('/api/manage_users', manageUsersRouter);
app.use('/api/company', companyRouter);
app.use('/api/customers', customerRouter);
app.use('/api/due_invoices', dueInvoicesRouter);
app.use('/api/sms', smsRouter);
app.use('/api', apiRouter);
app.use('/api/invoice_details', invoiceDetailsRouter);
app.use('/api/top-products-month', topProductsRouter); // إضافة هذا السطر
app.use('/', dashboardRouter);

// مسار بيانات الفواتير
app.get('/api/invoice-data', (req, res) => {
    const invoiceData = [
        {
            label: 'Invoice Data',
            labels: ['January', 'February', 'March'],
            values: [100, 200, 300]
        }
    ];
    res.json(invoiceData);
});

app.get('/api/auth/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ user: req.user });
    } else {
        res.status(401).json({ user: null });
    }
});

app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/dashboard', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ user: req.user });
    } else {
        res.redirect('/login');
    }
});

const createAdminUser = async () => {
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
        const newAdmin = new User({
            username: 'admin',
            password: 'admin123',
            role: 'admin',
            database: 'admin_db'
        });
        await newAdmin.save();
        console.log('Admin user created');
    }
};

createAdminUser();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// توجيه جميع الطلبات غير الموجهة إلى React
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});
