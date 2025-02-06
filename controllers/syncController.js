const { getDBPool } = require('../db');

// Sync data between Cloud DB and Local DB
exports.syncData = async (req, res) => {
  try {
    // Fetch orders from Local DB
    const localDB = getDBPool(false);  // false for Local DB
    const [localOrders] = await localDB.query('SELECT * FROM tbl_orders WHERE status = "Pending"');

    // Fetch Cloud DB connection
    const cloudDB = getDBPool(true);  // true for Cloud DB

    // Sync data: Insert local orders into Cloud DB
    for (const order of localOrders) {
      await cloudDB.query('INSERT INTO tbl_orders (StockCode, Quantity, OrderDate) VALUES (?, ?, ?)', [
        order.StockCode,
        order.Quantity,
        order.OrderDate
      ]);
    }

    res.json({ message: 'Sync successful' });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error syncing data');
  }
};
