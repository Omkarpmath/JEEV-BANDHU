const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const WeightRecord = require('../models/WeightRecord');
const FeedRecord = require('../models/FeedRecord');
const Compliance = require('../models/Compliance');

// GET: Analytics Dashboard
router.get('/analytics', requireAuth, requireRole('farmer'), async (req, res) => {
    try {
        const period = req.query.period || '6m';
        const farmerId = req.session.userId;
        const db = getDB();

        // Get total animals
        const totalAnimals = await db.collection('animals').countDocuments({
            ownerId: new ObjectId(farmerId)
        });

        // Get average weight gain
        const avgWeightGain = await WeightRecord.getFarmAverageWeightGain(farmerId, period);

        // Calculate mortality rate
        const allAnimals = await db.collection('animals').find({
            ownerId: new ObjectId(farmerId)
        }).toArray();

        const deadAnimals = allAnimals.filter(a => a.status === 'deceased').length;
        const mortalityRate = totalAnimals > 0 ? ((deadAnimals / (totalAnimals + deadAnimals)) * 100).toFixed(1) : 0;

        // Get average FCR
        const avgFCR = await FeedRecord.getFarmAverageFCR(farmerId);

        // Get weight trends for chart
        const weightTrends = await WeightRecord.getWeightTrends(farmerId, period);

        // Get FCR trends for chart
        const fcrTrends = await FeedRecord.getFCRTrends(farmerId, period);

        // Get biosecurity score
        const complianceScore = await Compliance.getAverageScore(farmerId, 7);

        // Get individual animal weights for chart
        const animalWeights = [];
        for (const animal of allAnimals.filter(a => a.status !== 'deceased')) {
            const weightHistory = await WeightRecord.getWeightHistory(animal._id, 1);
            if (weightHistory.length > 0) {
                animalWeights.push({
                    name: animal.name,
                    weight: weightHistory[0].weight,
                    date: weightHistory[0].recordedDate
                });
            }
        }

        // Calculate mortality trend over time
        const mortalityTrend = await calculateMortalityTrend(farmerId, period, db);

        // Regional comparison data (sample - can be enhanced with real regional data)
        const regionalData = {
            growthRate: { yours: avgWeightGain, regional: 12 },
            feedEfficiency: { yours: avgFCR, regional: 2.5 },
            healthScore: { yours: complianceScore, regional: 75 },
            productivity: { yours: 85, regional: 70 }
        };

        res.render('farmer/analytics', {
            user: {
                id: req.session.userId,
                name: req.session.userName,
                role: req.session.userRole
            },
            period,
            kpis: {
                totalAnimals,
                avgWeightGain,
                mortalityRate,
                avgFCR
            },
            weightTrends,
            fcrTrends,
            regionalData,
            animalWeights,  // Add individual animal data
            mortalityTrend  // Add mortality trend data
        });

    } catch (error) {
        console.error('❌ Error loading analytics:', error);
        res.status(500).render('error', {
            user: {
                id: req.session.userId,
                name: req.session.userName,
                role: req.session.userRole
            },
            message: 'Failed to load analytics dashboard'
        });
    }
});

// POST: Add weight record
router.post('/api/analytics/weight', requireAuth, requireRole('farmer'), async (req, res) => {
    try {
        const { animalId, weight, recordedDate, notes } = req.body;

        if (!animalId || !weight) {
            return res.status(400).json({
                success: false,
                error: 'Animal ID and weight are required'
            });
        }

        // Verify animal belongs to farmer
        const db = getDB();
        const animal = await db.collection('animals').findOne({
            _id: new ObjectId(animalId),
            ownerId: new ObjectId(req.session.userId)
        });

        if (!animal) {
            return res.status(404).json({
                success: false,
                error: 'Animal not found'
            });
        }

        const record = await WeightRecord.addWeightRecord({
            animalId,
            weight,
            recordedDate,
            notes
        });

        res.json({
            success: true,
            message: 'Weight recorded successfully',
            record
        });

    } catch (error) {
        console.error('❌ Error adding weight record:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add weight record'
        });
    }
});

// POST: Add feed record
router.post('/api/analytics/feed', requireAuth, requireRole('farmer'), async (req, res) => {
    try {
        const { animalId, feedAmount, feedType, feedDate, notes } = req.body;

        if (!animalId || !feedAmount) {
            return res.status(400).json({
                success: false,
                error: 'Animal ID and feed amount are required'
            });
        }

        // Verify animal belongs to farmer
        const db = getDB();
        const animal = await db.collection('animals').findOne({
            _id: new ObjectId(animalId),
            ownerId: new ObjectId(req.session.userId)
        });

        if (!animal) {
            return res.status(404).json({
                success: false,
                error: 'Animal not found'
            });
        }

        const record = await FeedRecord.addFeedRecord({
            animalId,
            feedAmount,
            feedType,
            feedDate,
            notes
        });

        res.json({
            success: true,
            message: 'Feed consumption recorded successfully',
            record
        });

    } catch (error) {
        console.error('❌ Error adding feed record:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add feed record'
        });
    }
});

// Helper function to calculate mortality trend
async function calculateMortalityTrend(farmerId, period, db) {
    try {
        // Calculate date range  
        const endDate = new Date();
        const startDate = new Date();

        switch (period) {
            case '1m':
                startDate.setMonth(startDate.getMonth() - 1);
                break;
            case '6m':
                startDate.setMonth(startDate.getMonth() - 6);
                break;
            case '1y':
                startDate.setFullYear(startDate.getFullYear() - 1);
                break;
        }

        // Get all animals (including deceased)
        const allAnimals = await db.collection('animals').find({
            ownerId: new ObjectId(farmerId)
        }).toArray();

        // Group deceased animals by month
        const monthlyData = {};
        const totalByMonth = {};

        // Calculate total animals per month (cumulative)
        let runningTotal = allAnimals.length;

        // Process deceased animals
        const deceasedAnimals = allAnimals.filter(a => a.status === 'deceased' && a.updatedAt);

        // Create monthly buckets for the period
        const months = [];
        const current = new Date(startDate);
        while (current <= endDate) {
            const monthKey = current.toISOString().substring(0, 7);
            months.push(monthKey);
            monthlyData[monthKey] = 0;
            totalByMonth[monthKey] = runningTotal;
            current.setMonth(current.getMonth() + 1);
        }

        // Count deaths per month
        deceasedAnimals.forEach(animal => {
            const deathDate = new Date(animal.updatedAt);
            if (deathDate >= startDate && deathDate <= endDate) {
                const monthKey = deathDate.toISOString().substring(0, 7);
                if (monthlyData[monthKey] !== undefined) {
                    monthlyData[monthKey]++;
                }
            }
        });

        // Calculate mortality rate for each month
        const trend = months.map(month => {
            const deaths = monthlyData[month] || 0;
            const total = totalByMonth[month] || allAnimals.length;
            const rate = total > 0 ? ((deaths / total) * 100).toFixed(2) : 0;

            return {
                month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                rate: parseFloat(rate),
                deaths
            };
        });

        return trend;

    } catch (error) {
        console.error('Error calculating mortality trend:', error);
        // Return empty data if error
        return [
            { month: 'No data', rate: 0, deaths: 0 }
        ];
    }
}

module.exports = router;
