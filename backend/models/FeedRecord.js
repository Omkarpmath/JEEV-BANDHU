const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');

class FeedRecord {
    // Add a feed record for an animal
    static async addFeedRecord(recordData) {
        const db = getDB();

        const record = {
            animalId: new ObjectId(recordData.animalId),
            feedAmount: parseFloat(recordData.feedAmount), // in kg
            feedType: recordData.feedType || 'Standard Feed',
            feedDate: new Date(recordData.feedDate || Date.now()),
            notes: recordData.notes || '',
            createdAt: new Date()
        };

        const result = await db.collection('feed_records').insertOne(record);
        return { ...record, _id: result.insertedId };
    }

    // Get feed history for an animal
    static async getFeedHistory(animalId, limit = null) {
        const db = getDB();

        const query = db.collection('feed_records')
            .find({ animalId: new ObjectId(animalId) })
            .sort({ feedDate: -1 });

        if (limit) {
            query.limit(limit);
        }

        return await query.toArray();
    }

    // Get total feed consumed for an animal in a period
    static async getTotalFeedConsumed(animalId, startDate, endDate) {
        const db = getDB();

        const records = await db.collection('feed_records')
            .find({
                animalId: new ObjectId(animalId),
                feedDate: { $gte: new Date(startDate), $lte: new Date(endDate) }
            })
            .toArray();

        const total = records.reduce((sum, record) => sum + record.feedAmount, 0);
        return Math.round(total * 100) / 100;
    }

    // Calculate Feed Conversion Ratio (FCR) for an animal
    // FCR = Total Feed Consumed / Total Weight Gained
    // Lower FCR is better (means more efficient)
    static async calculateFCR(animalId) {
        const WeightRecord = require('./WeightRecord');

        const weightGainData = await WeightRecord.calculateWeightGain(animalId);

        if (weightGainData.totalGain <= 0) {
            return { fcr: 0, feedConsumed: 0, weightGained: 0 };
        }

        // Get weight records to determine tracking period
        const weightHistory = await WeightRecord.getWeightHistory(animalId);

        if (weightHistory.length < 2) {
            return { fcr: 0, feedConsumed: 0, weightGained: 0 };
        }

        // Sort by date
        weightHistory.sort((a, b) => new Date(a.recordedDate) - new Date(b.recordedDate));

        const startDate = weightHistory[0].recordedDate;
        const endDate = weightHistory[weightHistory.length - 1].recordedDate;

        const totalFeed = await this.getTotalFeedConsumed(animalId, startDate, endDate);

        const fcr = totalFeed / weightGainData.totalGain;

        return {
            fcr: Math.round(fcr * 100) / 100,
            feedConsumed: totalFeed,
            weightGained: weightGainData.totalGain
        };
    }

    // Get average FCR for all animals of a farmer
    static async getFarmAverageFCR(farmerId) {
        const db = getDB();

        const animals = await db.collection('animals').find({ ownerId: new ObjectId(farmerId) }).toArray();

        if (animals.length === 0) return 0;

        let totalFCR = 0;
        let animalCount = 0;

        for (const animal of animals) {
            const fcrData = await this.calculateFCR(animal._id);
            if (fcrData.fcr > 0) {
                totalFCR += fcrData.fcr;
                animalCount++;
            }
        }

        return animalCount > 0 ? Math.round((totalFCR / animalCount) * 100) / 100 : 0;
    }

    // Get FCR trends over time for charts
    static async getFCRTrends(farmerId, period = '6m') {
        const db = getDB();
        const WeightRecord = require('./WeightRecord');

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

        // Get all animals for this farmer
        const animals = await db.collection('animals').find({ ownerId: new ObjectId(farmerId) }).toArray();
        const animalIds = animals.map(a => a._id);

        // Get monthly FCR data
        const months = [];
        const currentDate = new Date(startDate);

        while (currentDate <= endDate) {
            const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
            const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

            let monthFCR = 0;
            let validAnimals = 0;

            for (const animalId of animalIds) {
                // Get weight gain for this month
                const weightRecords = await db.collection('weight_records')
                    .find({
                        animalId: animalId,
                        recordedDate: { $gte: monthStart, $lte: monthEnd }
                    })
                    .sort({ recordedDate: 1 })
                    .toArray();

                if (weightRecords.length >= 2) {
                    const weightGain = weightRecords[weightRecords.length - 1].weight - weightRecords[0].weight;
                    const feedConsumed = await this.getTotalFeedConsumed(animalId, monthStart, monthEnd);

                    if (weightGain > 0 && feedConsumed > 0) {
                        monthFCR += feedConsumed / weightGain;
                        validAnimals++;
                    }
                }
            }

            if (validAnimals > 0) {
                months.push({
                    month: monthStart.toISOString().substring(0, 7),
                    fcr: Math.round((monthFCR / validAnimals) * 100) / 100
                });
            }

            currentDate.setMonth(currentDate.getMonth() + 1);
        }

        return months;
    }
}

module.exports = FeedRecord;
