const express = require('express');
const router = express.Router();
const moment = require('moment');
const { getDatabase, ensureAuthenticated } = require('../utils/helpers');
const cache = require('memory-cache');

// Helper function to format debt values
const formatDebt = (value) => `$${Number(value).toFixed(2)}`;

// Helper function to validate and format date
const validateAndFormatDate = (dateString) => {
  const date = moment(dateString, moment.ISO_8601, true);
  if (date.isValid()) {
    return date.toISOString();
  }
  throw new Error(`Invalid date format: ${dateString}`);
};

// Helper function to fetch sales within a date range
const fetchSales = async (db, start, end) => {
  const sales = await db.collection('tbl_invoice_list').aggregate([
    {
      $addFields: {
        convertedDate: {
          $dateFromString: {
            dateString: "$in_list_datetime",
            format: "%Y-%m-%dT%H:%M:%S"
          }
        }
      }
    },
    {
      $match: {
        in_list_type_const: 102,
        convertedDate: {
          $gte: new Date(start),
          $lte: new Date(end)
        }
      }
    },
    {
      $group: {
        _id: null,
        totalSales: { $sum: "$in_list_net" }
      }
    }
  ]).toArray();
  return sales.length > 0 ? sales[0].totalSales : 0;
};

async function ensureIndexes(dbConnection) {
  await dbConnection.collection('tbl_invoice_list').createIndex({ in_list_datetime: 1 });
  await dbConnection.collection('tbl_invoice_list').createIndex({ in_list_type_const: 1 });
  await dbConnection.collection('tbl_invoice_list').createIndex({ in_list_net: 1 });
  await dbConnection.collection('tbl_invoice_list').createIndex({ in_list_type_id: 1 });
  await dbConnection.collection('tbl_invoice_list').createIndex({ in_list_xe_user_ad: 1 });
  await dbConnection.collection('tbl_invoice_list').createIndex({ in_list_agent_id: 1 });
  await dbConnection.collection('tbl_cust').createIndex({ cu_type: 1 });
  await dbConnection.collection('tbl_cust').createIndex({ cu_acc_id: 1 });
  await dbConnection.collection('tbl_gl').createIndex({ gl_ac_id: 1 });
  await dbConnection.collection('tbl_gl').createIndex({ gl_currency_id: 1 });
  await dbConnection.collection('tbl_currency').createIndex({ cur_lst_id: 1 });
  await dbConnection.collection('tbl_users').createIndex({ us_id: 1 });
  await dbConnection.collection('tbl_agent').createIndex({ ag_id: 1 });
}

async function getDatabaseWithIndexes(req) {
  const db = await getDatabase(req);
  if (db) {
    await ensureIndexes(db);
  }
  return db;
}

// Route to fetch invoice data
router.get('/api/invoice-data', ensureAuthenticated, async (req, res) => {
  const cachedData = cache.get('invoice-data');
  if (cachedData) {
    return res.json(cachedData);
  }
  try {
    const db = await getDatabaseWithIndexes(req);
    if (!db) throw new Error('Database connection failed');

    const { startDate: userStartDate, endDate: userEndDate } = req.query;
    const startDate = validateAndFormatDate(userStartDate || moment().subtract(11, 'months').startOf('month').toISOString());
    const endDate = validateAndFormatDate(userEndDate || moment().endOf('month').toISOString());

    const invoiceTypes = await db.collection('tbl_invoice_type').find({ in_type_const: 102 }).toArray();
    if (!invoiceTypes.length) return res.json([]);

    const salesDataPromises = invoiceTypes.map(async (type) => {
      const invoices = await db.collection('tbl_invoice_list').aggregate([
        {
          $addFields: {
            convertedDate: {
              $dateFromString: {
                dateString: "$in_list_datetime",
                format: "%Y-%m-%dT%H:%M:%S"
              }
            }
          }
        },
        {
          $match: {
            in_list_type_id: type.in_type_id,
            convertedDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
            in_list_net: { $ne: 0 }
          }
        },
        {
          $group: {
            _id: {
              intervalStart: {
                $subtract: [
                  "$convertedDate",
                  { $mod: [{ $subtract: ["$convertedDate", new Date(startDate)] }, 1000 * 60 * 60 * 24 * 30] }
                ]
              }
            },
            total: { $sum: "$in_list_net" }
          }
        },
        { $sort: { "_id.intervalStart": 1 } }
      ]).toArray();

      if (!invoices.length) return null;

      const data = invoices.map(invoice => ({
        label: moment(invoice._id.intervalStart).format('MMMM YYYY'),
        value: invoice.total
      }));

      return {
        label: type.in_type_name,
        data: data
      };
    });

    const salesData = (await Promise.all(salesDataPromises)).filter(data => data !== null);

    // Adding total sales data
    const totalSalesData = salesData.reduce((acc, curr) => {
      curr.data.forEach(d => {
        if (!acc[d.label]) {
          acc[d.label] = 0;
        }
        acc[d.label] += d.value;
      });
      return acc;
    }, {});

    const totalSalesArray = Object.keys(totalSalesData).map(label => ({
      label: label,
      value: totalSalesData[label]
    })).sort((a, b) => moment(a.label, 'MMMM YYYY') - moment(b.label, 'MMMM YYYY'));

    salesData.push({
      label: "إجمالي المبيعات",
      data: totalSalesArray
    });

    cache.put('invoice-data', salesData, 60000); // Cache for 60 seconds

    res.json(salesData);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching invoice data' });
  }
});

// Route to fetch summary data
router.get('/api/summary-data', ensureAuthenticated, async (req, res) => {
  const cachedData = cache.get('summary-data');
  if (cachedData) {
    return res.json(cachedData);
  }
  try {
    const db = await getDatabaseWithIndexes(req);
    if (!db) throw new Error('Database connection failed');

    const totalCustomers = await db.collection('tbl_cust').countDocuments({ cu_type: 0 });

    const totalCustomerDebt = await db.collection('tbl_cust').aggregate([
      { $match: { cu_type: 0 } },
      {
        $lookup: {
          from: "tbl_gl",
          localField: "cu_acc_id",
          foreignField: "gl_ac_id",
          as: "gl_records"
        }
      },
      { $unwind: "$gl_records" },
      {
        $group: {
          _id: "$gl_records.gl_currency_id",
          totalDebt: { $sum: { $subtract: ["$gl_records.gl_debit", "$gl_records.gl_credit"] } }
        }
      },
      {
        $lookup: {
          from: 'tbl_currency',
          localField: '_id',
          foreignField: 'cur_lst_id',
          as: 'currency_info'
        }
      },
      { $unwind: "$currency_info" },
      {
        $project: {
          currency: "$currency_info.cur_lst_name",
          totalDebt: 1
        }
      }
    ]).toArray();

    const totalSupplierDebt = await db.collection('tbl_cust').aggregate([
      { $match: { cu_type: 1 } },
      {
        $lookup: {
          from: "tbl_gl",
          localField: "cu_acc_id",
          foreignField: "gl_ac_id",
          as: "gl_records"
        }
      },
      { $unwind: "$gl_records" },
      {
        $group: {
          _id: "$gl_records.gl_currency_id",
          totalDebt: { $sum: { $subtract: ["$gl_records.gl_credit", "$gl_records.gl_debit"] } }
        }
      },
      {
        $lookup: {
          from: 'tbl_currency',
          localField: '_id',
          foreignField: 'cur_lst_id',
          as: 'currency_info'
        }
      },
      { $unwind: "$currency_info" },
      {
        $project: {
          currency: "$currency_info.cur_lst_name",
          totalDebt: 1
        }
      }
    ]).toArray();

    const startCurrentMonth = moment().subtract(30, 'days').startOf('day').toISOString();
    const endCurrentMonth = moment().endOf('day').toISOString();
    const startPreviousMonth = moment().subtract(60, 'days').startOf('day').toISOString();
    const endPreviousMonth = moment().subtract(30, 'days').endOf('day').toISOString();

    const currentMonthSales = await fetchSales(db, startCurrentMonth, endCurrentMonth);
    const previousMonthSales = await fetchSales(db, startPreviousMonth, endPreviousMonth);

    const summaryData = {
      totalCustomers,
      totalCustomerDebt: totalCustomerDebt.map(debt => ({ currency: debt.currency, totalDebt: Number(debt.totalDebt).toFixed(2) })),
      totalSupplierDebt: totalSupplierDebt.map(debt => ({ currency: debt.currency, totalDebt: Number(debt.totalDebt).toFixed(2) })),
      currentMonthSales,
      previousMonthSales
    };

    cache.put('summary-data', summaryData, 60000); // Cache for 60 seconds

    res.json(summaryData);
  } catch (error) {
    console.error("Error fetching summary data: ", error);
    res.status(500).json({ error: 'Error fetching summary data' });
  }
});

// Route to fetch top users for the month
router.get('/api/top-users-month', ensureAuthenticated, async (req, res) => {
  const cachedData = cache.get('top-users-month');
  if (cachedData) {
    return res.json(cachedData);
  }
  try {
    const db = await getDatabaseWithIndexes(req);
    const startOfMonth = validateAndFormatDate(moment().startOf('month').toISOString());
    const endOfMonth = validateAndFormatDate(moment().endOf('month').toISOString());

    const topUsers = await db.collection('tbl_invoice_list').aggregate([
      {
        $addFields: {
          convertedDate: {
            $dateFromString: {
              dateString: "$in_list_datetime",
              format: "%Y-%m-%dT%H:%M:%S"
            }
          }
        }
      },
      { $match: { in_list_type_const: 102, convertedDate: { $gte: new Date(startOfMonth), $lte: new Date(endOfMonth) } } },
      {
        $group: {
          _id: "$in_list_xe_user_ad",
          count: { $sum: 1 },
          total: { $sum: "$in_list_net" }
        }
      },
      { $sort: { total: -1, count: -1 } },
      { $limit: 3 },
      {
        $lookup: {
          from: 'tbl_users',
          localField: '_id',
          foreignField: 'us_id',
          as: 'user_info'
        }
      },
      { $unwind: "$user_info" },
      {
        $project: {
          _id: 0,
          name: "$user_info.us_full_name",
          count: 1,
          total: 1
        }
      }
    ]).toArray();

    cache.put('top-users-month', topUsers, 60000); // Cache for 60 seconds

    res.json(topUsers);
  } catch (error) {
    console.error('Error fetching top users for the month:', error);
    res.status(500).json({ error: 'Error fetching top users for the month' });
  }
});

// Route to fetch top agents for the month
router.get('/api/top-agents-month', ensureAuthenticated, async (req, res) => {
  const cachedData = cache.get('top-agents-month');
  if (cachedData) {
    return res.json(cachedData);
  }
  try {
    const db = await getDatabaseWithIndexes(req);
    const startOfMonth = validateAndFormatDate(moment().startOf('month').toISOString());
    const endOfMonth = validateAndFormatDate(moment().endOf('month').toISOString());

    const topAgents = await db.collection('tbl_invoice_list').aggregate([
      {
        $addFields: {
          convertedDate: {
            $dateFromString: {
              dateString: "$in_list_datetime",
              format: "%Y-%m-%dT%H:%M:%S"
            }
          }
        }
      },
      { $match: { in_list_type_const: 102, convertedDate: { $gte: new Date(startOfMonth), $lte: new Date(endOfMonth) } } },
      {
        $group: {
          _id: "$in_list_agent_id",
          count: { $sum: 1 },
          total: { $sum: "$in_list_net" }
        }
      },
      { $sort: { total: -1, count: -1 } },
      { $limit: 3 },
      {
        $lookup: {
          from: 'tbl_agent',
          localField: '_id',
          foreignField: 'ag_id',
          as: 'agent_info'
        }
      },
      { $unwind: "$agent_info" },
      {
        $project: {
          _id: 0,
          name: "$agent_info.ag_name",
          count: 1,
          total: 1
        }
      }
    ]).toArray();

    cache.put('top-agents-month', topAgents, 60000); // Cache for 60 seconds

    res.json(topAgents);
  } catch (error) {
    console.error('Error fetching top agents for the month:', error);
    res.status(500).json({ error: 'Error fetching top agents for the month' });
  }
});

module.exports = router;
