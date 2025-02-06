const { getDBPool } = require('../db');

// Create an order in either cloud or local database
exports.createOrder = async (req, res) => {
  const { stockCode, quantity, isLocal } = req.body;

  try {
    // Get the appropriate DB (Cloud or Local)
    const db = getDBPool(isLocal);  // If isLocal is true, connect to local DB, else cloud DB

    // Create the order in the chosen database (Cloud or Local)
    const [order] = await db.query('INSERT INTO tbl_orders (StockCode, Quantity, OrderDate) VALUES (?, ?, ?)', [
      stockCode,
      quantity,
      new Date()
    ]);

    // Send response with order ID
    res.status(201).json({ message: 'Order created successfully', orderId: order.insertId });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error creating order');
  }
};
