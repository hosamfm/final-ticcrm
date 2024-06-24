const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const User = require('../models/User');

module.exports = function(passport) {
    passport.use(new LocalStrategy({ usernameField: 'identifier' }, async (identifier, password, done) => {
        try {
            const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] }).populate('company');
            if (!user) {
                return done(null, false, { message: 'This username/email is not registered' });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (isMatch) {
                return done(null, user);
            } else {
                return done(null, false, { message: 'Password incorrect' });
            }
        } catch (err) {
            return done(err);
        }
    }));

    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    passport.deserializeUser(async (id, done) => {
        try {
            const user = await User.findById(id).populate('company');
            if (user.role === 'employee') {
                const supervisor = await User.findById(user.company);
                user.supervisorDatabase = supervisor ? supervisor.database : null;
            }
            done(null, user);
        } catch (err) {
            done(err, null);
        }
    });
};
