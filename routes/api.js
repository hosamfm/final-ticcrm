const express = require('express');
const router = express.Router();
const axios = require('axios');
const Geonames = require('geonames.js');
const geoip = require('geoip-lite');

require('dotenv').config();

const geonames = new Geonames({
    username: process.env.GEONAMES_USERNAME,
    lan: 'ar', // استخدام اللغة الإنجليزية كافتراضية
    encoding: 'JSON'
});

const allowedCountries = [
    'DZ', 'BH', 'EG', 'IQ', 'JO', 'KW', 'LB', 'LY', 'MA', 'OM', 'QA', 'SA', 'SY', 'TN', 'AE', 'YE', 'PS', 'TR', // الدول العربية وتركيا
    'AL', 'AD', 'AM', 'AT', 'AZ', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'GE', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'KZ', 'LV', 'LI', 'LT', 'LU', 'MT', 'MD', 'MC', 'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'RU', 'SM', 'RS', 'SK', 'SI', 'ES', 'SE', 'CH', 'UA', 'GB', 'VA' // الدول الأوروبية
];

router.get('/countries', async (req, res) => {
    try {
        const response = await geonames.countryInfo({});
        const countries = response.geonames
            .filter(country => allowedCountries.includes(country.countryCode))
            .map(country => ({
                code: country.countryCode,
                name: country.countryName
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ar'));  // ترتيب الدول بالأبجدية العربية
        res.json(countries);
    } catch (err) {
        console.error('Error fetching countries:', err);
        res.status(500).send('Server Error');
    }
});

router.get('/default-country', (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const geo = geoip.lookup(ip);
    let defaultCountry = 'LY'; // ضبط ليبيا كدولة افتراضية
    if (geo && allowedCountries.includes(geo.country)) {
        defaultCountry = geo.country;
    }
    res.json({ country: defaultCountry });
});

module.exports = router;
