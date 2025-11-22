require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const path = require('path');
const { connectDB } = require('./config/database');
const { autoUnlockExpired } = require('./middleware/bioSafety');

const app = express();
const PORT = process.env.PORT || 3000;

// Session store
const store = new MongoDBStore({
    uri: process.env.MONGODB_URI,
    collection: 'sessions',
    expires: 1000 * 60 * 60 * 24 * 7 // 7 days
});

store.on('error', function (error) {
    console.error('Session store error:', error);
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'jeevbandhu-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' // HTTPS only in production
    }
}));

// Auto-unlock expired animals on every request
app.use(autoUnlockExpired);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../frontend/views'));

// Routes
const authRoutes = require('./routes/auth');
const animalRoutes = require('./routes/animals');
const medicalRoutes = require('./routes/medical');
const marketplaceRoutes = require('./routes/marketplace');
const aiRoutes = require('./routes/ai');

app.use('/', authRoutes);
app.use('/', animalRoutes);
app.use('/', medicalRoutes);
app.use('/', marketplaceRoutes);
app.use('/orders', require('./routes/orders'));
app.use('/guide', require('./routes/guide'));
app.use('/', aiRoutes);
app.use('/', require('./routes/community'));
app.use('/', require('./routes/compliance'));


// Home route
app.get('/', (req, res) => {
    // If logged in, redirect to appropriate dashboard
    if (req.session && req.session.userId) {
        if (req.session.userRole === 'farmer') {
            return res.redirect('/dashboard');
        } else {
            return res.redirect('/marketplace');
        }
    }

    res.render('index', { user: null });
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', {
        user: req.session && req.session.userId ? { role: req.session.userRole } : null,
        message: 'Page not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).render('error', {
        user: req.session && req.session.userId ? { role: req.session.userRole } : null,
        message: 'Internal server error'
    });
});

// Start server
async function startServer() {
    try {
        await connectDB();
        app.listen(PORT, () => {
            console.log(`✅ JeevBandhu server running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n⏳ Shutting down gracefully...');
    const { closeDB } = require('./config/database');
    await closeDB();
    process.exit(0);
});
