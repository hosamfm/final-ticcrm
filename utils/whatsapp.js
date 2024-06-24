// utils/whatsapp.js
const fetch = require('node-fetch');
const SentMessageSchema = require('../models/SentMessage').schema;
const SentInvoiceSchema = require('../models/SentInvoice').schema;

function formatPhoneNumber(phone) {
    let cleanedPhone = phone.replace(/\D/g, '');
    if (cleanedPhone.startsWith('00')) {
        cleanedPhone = cleanedPhone.slice(2);
    }
    if (cleanedPhone.startsWith('09')) {
        cleanedPhone = '218' + cleanedPhone.slice(1);
    }
    return cleanedPhone;
}

async function sendWhatsAppMessage(db, phone, customerName, currentBalance, currency, invoices, userId) {
    try {
        const url = 'https://graph.facebook.com/v18.0/193267270540161/messages';
        const authToken = 'EAAMNzEgyuUkBOwdAYgW56EkPgesRRmUNbfxB7IaIbSci9scSU33xZBXlvJLg91hD7LfxfOIFiJvID9M1LWP39gCarsZAY50j71ZA3u2Pv84ZCpDxyzwKCo0A1xkt0S5NkqdN2RZB4Q0uM777ox8gMhvqPFiMLjONIedU5w1tHy8dZAiFcfHm3zieVvscc0V6ZBv';

        phone = formatPhoneNumber(phone);

        let variable3 = '';
        if (invoices.length === 0) {
            variable3 = ' ';
        } else {
            variable3 = 'تفاصيل اخر فواتير هي كالتالي:\\n';
            invoices.forEach((invoice, index) => {
                variable3 += `${index + 1}. فاتورة رقم ${invoice.invoice_number}: بقيمة إجمالية ${Math.round(invoice.invoice_net).toLocaleString('en-US', { minimumFractionDigits: 0 })} ${invoice.currency_name}, ` +
                            `المبلغ المتبقي ${Math.round(invoice.remaining_amount).toLocaleString('en-US', { minimumFractionDigits: 0 })} ${invoice.currency_name}. تأخرت عن موعد سدادها  ${invoice.due_days_remain} يوم.\\n`;
                if (variable3.length > 1000) {
                    variable3 += '...\\nللمزيد من التفاصيل، يرجى مراجعة الحساب الخاص بكم.';
                    return false;
                }
            });
        }

        const body = {
            messaging_product: "whatsapp",
            to: phone,
            type: "template",
            template: {
                name: "invoice_remainder",
                language: {
                    code: "ar"
                },
                components: [
                    {
                        type: "header",
                        parameters: [
                            {
                                type: "image",
                                image: {
                                    link: "https://i.postimg.cc/4xxWVyZx/Untitled-2-copy.jpg"
                                }
                            }
                        ]
                    },
                    {
                        type: "body",
                        parameters: [
                            {
                                type: "text",
                                text: customerName
                            },
                            {
                                type: "text",
                                text: `${currentBalance} ${currency}`
                            },
                            {
                                type: "text",
                                text: variable3
                            }
                        ]
                    }
                ]
            }
        };


        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Failed to send WhatsApp message, response status:', response.status, response.statusText, 'Response text:', errorText);
            throw new Error('Failed to send WhatsApp message, response status: ' + response.status + ' ' + response.statusText);
        }

        const result = await response.json();

        if (result.error) {
            console.error('Error from WhatsApp API:', result);
            throw new Error(result.error.message || 'Unknown error from WhatsApp API');
        }

        const SentMessage = db.model('SentMessage', SentMessageSchema);
        const sentMessage = new SentMessage({
            phone,
            message: variable3,
            customerName,
            sentBy: userId
        });

        await sentMessage.save();

        const SentInvoice = db.model('SentInvoice', SentInvoiceSchema);
        for (const invoice of invoices) {
            const sentInvoice = new SentInvoice({
                messageId: sentMessage._id,
                invoiceId: String(invoice.invoice_id),
                invoiceNumber: invoice.invoice_number,
                invoicePayment: invoice.invoice_payment,
                invoiceNet: invoice.invoice_net,
                remainingAmount: invoice.remaining_amount,
                dueDaysRemain: invoice.due_days_remain
            });
            await sentInvoice.save();
        }

        return true;
    } catch (error) {
        console.error('Error in sendWhatsAppMessage:', error.message);
        throw error;
    }
}

module.exports = { sendWhatsAppMessage };
