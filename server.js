// server.js

const express = require('express');
const app = express();
const categoryRoutes = require('./routes/category');
const productRoutes = require('./routes/product');
const shopRoutes = require('./routes/shop');
const orderRoutes = require('./routes/order');
const userRoutes = require('./routes/auth');
const storeRoutes = require('./routes/store');
require('dotenv').config();
const cors = require('cors');
// Middleware
app.use(express.json());  // for parsing application/json
app.use(cors({
  origin: "http://localhost:5173", // Frontend ka URL
  methods: "GET,POST,PUT,DELETE",
  credentials: true 
}));
// API routes
app.use('/api', categoryRoutes);
app.use('/api', productRoutes);
app.use('/api', shopRoutes);
app.use('/api', orderRoutes);
app.use('/api', userRoutes);
app.use('/api',storeRoutes);
// Starting the server
const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
