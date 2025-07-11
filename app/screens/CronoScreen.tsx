import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Button,
  Platform,
  Alert,
  Linking,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import * as HealthConnectLibrary from 'react-native-health-connect';

// Update required permissions to match what's shown in logs
const REQUIRED_PERMISSIONS = [
  { accessType: 'read', recordType: 'Nutrition' },
  { accessType: 'read', recordType: 'Hydration' }, // Changed from HydrationRecord to Hydration
];
const POLL_INTERVAL_MS = 60 * 1000; // 1 minute

export default function CronoScreen({ navigation }) {
  const [nutritionData, setNutritionData] = useState({
    calories: null,
    protein: null,
    fat: null,
    carbs: null,
    fiber: null,
    sugar: null,
    sodium: null,
    water: null,
    meals: [],
  });
  const [loading, setLoading] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const poller = useRef(null);

  const ensurePermissions = async () => {
    try {
      setPermissionError('');

      if (typeof HealthConnectLibrary.initialize === 'function') {
        await HealthConnectLibrary.initialize();
        console.log('Health Connect initialized');
      }

      const sdkStatus = await HealthConnectLibrary.getSdkStatus();
      console.log('SDK Status:', sdkStatus);
      if (sdkStatus !== HealthConnectLibrary.SdkAvailabilityStatus.SDK_AVAILABLE) {
        setPermissionError('Health Connect not available. Status: ' + sdkStatus);
        Alert.alert('Unavailable', 'Health Connect is not available on this device.');
        return false;
      }

      // Get granted permissions to see what we have
      const grantedPerms = await HealthConnectLibrary.getGrantedPermissions();
      console.log('Granted permissions:', JSON.stringify(grantedPerms));

      // Check if we have the permissions we need
      const allGranted = REQUIRED_PERMISSIONS.every((perm) =>
        grantedPerms.some(
          (g) => g.recordType === perm.recordType && g.accessType === perm.accessType
        )
      );

      if (!allGranted) {
        console.log('Not all nutrition permissions granted');

        // Instead of using requestPermissions (which doesn't exist), guide the user
        Alert.alert(
          'Permission Required',
          'Please grant Nutrition permissions in Health Connect:\n\n1. Open Health Connect\n2. Go to Data & Access\n3. Find this app and enable nutrition access\n4. Also connect Cronometer and enable its data sharing',
          [
            {
              text: 'Open Health Connect',
              onPress: () =>
                Linking.openURL('package:com.google.android.apps.healthdata').catch(() =>
                  Linking.openURL('market://details?id=com.google.android.apps.healthdata')
                ),
            },
            { text: 'Cancel' },
          ]
        );
        return false;
      }

      console.log('All nutrition permissions granted');
      return true;
    } catch (error) {
      console.error('Permission error:', error);
      setPermissionError('Error: ' + error.message);
      return false;
    }
  };

  const fetchNutritionData = async () => {
    try {
      setLoading(true);
      const endTime = new Date();
      // Set startTime to today at midnight
      const startTime = new Date(endTime);
      startTime.setHours(0, 0, 0, 0);

      console.log(
        `Fetching nutrition data for today: ${startTime.toISOString()} to ${endTime.toISOString()}`
      );

      // Attempt to read data even if we're not sure about permissions
      try {
        // Fetch nutrition records
        const nutritionRecords = await HealthConnectLibrary.readRecords('Nutrition', {
          timeRangeFilter: {
            operator: 'between',
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
          },
        });
        console.log('Nutrition records:', JSON.stringify(nutritionRecords));

        // Fetch hydration records - update record type to match what's available
        const hydrationRecords = await HealthConnectLibrary.readRecords('Hydration', {
          timeRangeFilter: {
            operator: 'between',
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
          },
        });
        console.log('Hydration records:', JSON.stringify(hydrationRecords));

        // Process nutrition data
        const meals = [];
        let totalCalories = 0;
        let totalProtein = 0;
        let totalFat = 0;
        let totalCarbs = 0;
        let totalFiber = 0;
        let totalSugar = 0;
        let totalSodium = 0;

        if (nutritionRecords?.records && Array.isArray(nutritionRecords.records)) {
          nutritionRecords.records.forEach((record) => {
            // Log each record to understand its structure
            console.log('Processing nutrition record:', JSON.stringify(record));

            const mealData = {
              name: record.name || 'Unnamed meal',
              time: new Date(record.startTime).toLocaleTimeString(),
              calories: record.energy?.inKilocalories || 0,
              protein: record.protein?.inGrams || 0,
              fat: record.totalFat?.inGrams || 0,
              carbs: record.totalCarbohydrate?.inGrams || 0,
              nutrients: [],
            };

            // Add specific nutrients if available
            if (record.dietaryFiber?.inGrams) {
              mealData.nutrients.push(`Fiber: ${record.dietaryFiber.inGrams.toFixed(1)}g`);
              totalFiber += record.dietaryFiber.inGrams;
            }
            if (record.sugar?.inGrams) {
              mealData.nutrients.push(`Sugar: ${record.sugar.inGrams.toFixed(1)}g`);
              totalSugar += record.sugar.inGrams;
            }
            if (record.sodium?.inMilligrams) {
              mealData.nutrients.push(`Sodium: ${record.sodium.inMilligrams.toFixed(0)}mg`);
              totalSodium += record.sodium.inMilligrams;
            }

            meals.push(mealData);

            totalCalories += mealData.calories;
            totalProtein += mealData.protein;
            totalFat += mealData.fat;
            totalCarbs += mealData.carbs;
          });
        }

        // Process hydration data
        let totalWater = 0;
        if (hydrationRecords?.records && Array.isArray(hydrationRecords.records)) {
          console.log('Processing hydration records:', JSON.stringify(hydrationRecords.records));
          totalWater = hydrationRecords.records.reduce(
            (sum, record) => sum + (record.volume?.inLiters || 0),
            0
          );
        }

        setNutritionData({
          calories: totalCalories,
          protein: totalProtein,
          fat: totalFat,
          carbs: totalCarbs,
          fiber: totalFiber,
          sugar: totalSugar,
          sodium: totalSodium,
          water: totalWater,
          meals: meals,
        });

        console.log('Updated nutrition data:', {
          calories: totalCalories,
          protein: totalProtein,
          fat: totalFat,
          carbs: totalCarbs,
          water: totalWater,
        });
      } catch (readError) {
        console.error('Error reading nutrition data:', readError);
        throw readError;
      }
    } catch (err) {
      console.error('Fetch nutrition error:', err);
      Alert.alert('Error', 'Failed to fetch nutrition data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      const ok = await ensurePermissions();
      setHasPermission(ok);
      if (ok) {
        await fetchNutritionData();
        poller.current = setInterval(fetchNutritionData, POLL_INTERVAL_MS);
      }
    })();

    return () => {
      if (poller.current) clearInterval(poller.current);
    };
  }, []);

  if (!hasPermission) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Cronometer Import</Text>
        </View>
        <ScrollView contentContainerStyle={styles.center}>
          <Ionicons name="nutrition" size={48} color="#C7312B" style={{ marginBottom: 10 }} />
          <Text style={styles.title}>Nutrition Tracker</Text>
          <Text style={styles.warning}>Nutrition permissions not granted</Text>
          {permissionError && <Text style={styles.errorDetails}>{permissionError}</Text>}
          <Text style={styles.instructions}>
            To access nutrition data, please:
            {'\n\n'}
            1. Make sure Health Connect is updated to the latest version
            {'\n'}
            2. Open Health Connect
            {'\n'}
            3. Go to "Data and access"
            {'\n'}
            4. Find this app and grant nutrition access
            {'\n'}
            5. Connect Cronometer in Health Connect
            {'\n'}
            6. Enable nutrition data sharing for Cronometer
            {'\n\n'}
            Note: Health Connect shows you have these permissions, but data might not be syncing
            correctly from Cronometer.
          </Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() =>
                Linking.openURL('package:com.google.android.apps.healthdata').catch(() =>
                  Linking.openURL('market://details?id=com.google.android.apps.healthdata')
                )
              }>
              <Ionicons name="open-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.actionButtonText}>Open Health Connect</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={async () => {
                const ok = await ensurePermissions();
                setHasPermission(ok);
                if (ok) await fetchNutritionData();
              }}>
              <Feather name="refresh-ccw" size={18} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.actionButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cronometer Import</Text>
      </View>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="nutrition" size={32} color="#C7312B" style={{ marginRight: 10 }} />
            <Text style={styles.cardTitle}>Today's Nutrition</Text>
          </View>
          {loading ? (
            <ActivityIndicator size="large" style={styles.loader} color="#C7312B" />
          ) : (
            <>
              <View style={styles.calorieCard}>
                <Text style={styles.calorieCount}>
                  {nutritionData.calories !== null ? Math.round(nutritionData.calories) : '—'} kcal
                </Text>
                <Text style={styles.calorieLabel}>Calories</Text>
              </View>
              <View style={styles.macrosContainer}>
                <View style={styles.macroItem}>
                  <Text style={styles.macroValue}>
                    {nutritionData.protein !== null ? nutritionData.protein.toFixed(1) : '—'}g
                  </Text>
                  <Text style={styles.macroLabel}>Protein</Text>
                </View>
                <View style={styles.macroItem}>
                  <Text style={styles.macroValue}>
                    {nutritionData.fat !== null ? nutritionData.fat.toFixed(1) : '—'}g
                  </Text>
                  <Text style={styles.macroLabel}>Fat</Text>
                </View>
                <View style={styles.macroItem}>
                  <Text style={styles.macroValue}>
                    {nutritionData.carbs !== null ? nutritionData.carbs.toFixed(1) : '—'}g
                  </Text>
                  <Text style={styles.macroLabel}>Carbs</Text>
                </View>
              </View>
              <View style={styles.nutritionCard}>
                <Text style={styles.sectionTitle}>Additional Nutrients</Text>
                <View style={styles.nutrientRow}>
                  <Text style={styles.nutrientLabel}>Fiber:</Text>
                  <Text style={styles.nutrientValue}>
                    {nutritionData.fiber !== null ? nutritionData.fiber.toFixed(1) : '—'}g
                  </Text>
                </View>
                <View style={styles.nutrientRow}>
                  <Text style={styles.nutrientLabel}>Sugar:</Text>
                  <Text style={styles.nutrientValue}>
                    {nutritionData.sugar !== null ? nutritionData.sugar.toFixed(1) : '—'}g
                  </Text>
                </View>
                <View style={styles.nutrientRow}>
                  <Text style={styles.nutrientLabel}>Sodium:</Text>
                  <Text style={styles.nutrientValue}>
                    {nutritionData.sodium !== null ? nutritionData.sodium.toFixed(0) : '—'}mg
                  </Text>
                </View>
                <View style={styles.nutrientRow}>
                  <Text style={styles.nutrientLabel}>Water:</Text>
                  <Text style={styles.nutrientValue}>
                    {nutritionData.water !== null ? (nutritionData.water * 1000).toFixed(0) : '—'}ml
                  </Text>
                </View>
              </View>
              {nutritionData.meals.length > 0 ? (
                <>
                  <Text style={styles.sectionTitle}>Today's Meals</Text>
                  {nutritionData.meals.map((meal, index) => (
                    <View key={index} style={styles.mealCard}>
                      <View style={styles.mealHeader}>
                        <Text style={styles.mealName}>{meal.name}</Text>
                        <Text style={styles.mealTime}>{meal.time}</Text>
                      </View>
                      <View style={styles.mealNutrition}>
                        <Text style={styles.mealNutritionText}>
                          Calories: {meal.calories.toFixed(0)} kcal
                        </Text>
                        <Text style={styles.mealNutritionText}>
                          P: {meal.protein.toFixed(1)}g | F: {meal.fat.toFixed(1)}g | C:{' '}
                          {meal.carbs.toFixed(1)}g
                        </Text>
                        {meal.nutrients.map((nutrient, i) => (
                          <Text key={i} style={styles.mealNutrient}>
                            {nutrient}
                          </Text>
                        ))}
                      </View>
                    </View>
                  ))}
                </>
              ) : (
                <Text style={styles.noData}>No meals recorded today</Text>
              )}
              <Text style={styles.dataSource}>Data Source: Cronometer via Health Connect</Text>
              <Text style={styles.refreshTime}>
                Last updated: {new Date().toLocaleTimeString()}
              </Text>
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={fetchNutritionData}
                disabled={loading}>
                <Feather name="refresh-ccw" size={18} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.refreshButtonText}>Refresh Now</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f8', paddingHorizontal: 0 },
  header: {
    backgroundColor: '#081A2F',
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 16,
    paddingHorizontal: 18,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    marginBottom: 10,
  },
  backButton: {
    marginRight: 10,
    padding: 4,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
    marginRight: 30,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    margin: 18,
    marginTop: 0,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#081A2F',
  },
  calorieCard: {
    alignItems: 'center',
    marginBottom: 12,
  },
  calorieCount: { fontSize: 40, fontWeight: 'bold', color: '#C7312B' },
  calorieLabel: { fontSize: 16, color: '#666', marginTop: 2 },
  macrosContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  macroItem: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  macroValue: { fontSize: 20, fontWeight: 'bold', color: '#081A2F' },
  macroLabel: { fontSize: 14, color: '#666' },
  nutritionCard: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginVertical: 8, color: '#081A2F' },
  nutrientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  nutrientLabel: { fontSize: 15, color: '#444' },
  nutrientValue: { fontSize: 15, fontWeight: '500', color: '#C7312B' },
  mealCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    elevation: 1,
    borderLeftWidth: 4,
    borderLeftColor: '#C7312B',
  },
  mealHeader: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  mealName: { fontSize: 15, fontWeight: 'bold', color: '#081A2F' },
  mealTime: { fontSize: 13, color: '#666' },
  mealNutrition: { marginTop: 2 },
  mealNutritionText: { fontSize: 14, color: '#333' },
  mealNutrient: { fontSize: 13, color: '#666', marginTop: 2 },
  noData: { textAlign: 'center', marginVertical: 20, color: '#666', fontStyle: 'italic' },
  dataSource: { fontSize: 13, color: '#666', textAlign: 'center', marginTop: 10 },
  refreshTime: { fontSize: 12, color: '#888', textAlign: 'center', marginBottom: 10 },
  refreshButton: {
    backgroundColor: '#C7312B',
    paddingVertical: 12,
    borderRadius: 30,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 10,
    alignSelf: 'center',
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  refreshButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  center: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  warning: { fontSize: 16, color: 'red', marginBottom: 10, textAlign: 'center' },
  errorDetails: { fontSize: 14, color: '#666', marginBottom: 20, textAlign: 'center' },
  instructions: { fontSize: 15, textAlign: 'center', marginVertical: 15, paddingHorizontal: 10 },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 18,
    gap: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#C7312B',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
    marginHorizontal: 6,
    marginBottom: 6,
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  loader: { marginTop: 30 },
});
