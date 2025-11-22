require('dotenv').config();
const { MongoClient } = require('mongodb');

async function clearDatabase() {
    const client = new MongoClient(process.env.MONGODB_URI);

    try {
        await client.connect();
        console.log('✅ Connected to MongoDB');

        const db = client.db('jeevbandhu');

        // Get all collections
        const collections = await db.listCollections().toArray();

        console.log('\n🗑️  Deleting all data from the following collections:');
        collections.forEach(col => console.log(`   - ${col.name}`));

        // Delete all documents from each collection
        for (const collection of collections) {
            const result = await db.collection(collection.name).deleteMany({});
            console.log(`✅ Deleted ${result.deletedCount} documents from ${collection.name}`);
        }

        console.log('\n✅ Database cleared successfully!');

    } catch (error) {
        console.error('❌ Error clearing database:', error);
    } finally {
        await client.close();
        console.log('✅ Connection closed');
    }
}

clearDatabase();
