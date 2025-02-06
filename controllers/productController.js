const { getDBPool } = require('../db.js');

// Fetch products (Cloud or Local based on request)
exports.getProducts = async (req, res) => {
  try {
    // Cloud DB connection by default
    const db = getDBPool(true);  // true for Cloud DB
    
    // Fetch products from the tblproducts table in the cloud database
    const [products] = await db.query('SELECT * FROM tblproducts WHERE StockOnHand > 0');
    
    // Respond with the products
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching products');
  }
};
