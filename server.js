const express = require('express');
const bodyParser = require('body-parser');
const { getDBPool } = require('./db.js');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(bodyParser.json());

// Routes
app.get('/api/products', require('./controllers/productController.js').getProducts);
app.post('/api/orders', require('./controllers/orderController').createOrder);
app.post('/api/sync', require('./controllers/syncController').syncData);

// Server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
