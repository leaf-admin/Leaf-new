/**
 * LanguageAnalyticsScreen - Tela de analytics de idiomas
 * 
 * Interface para visualizar métricas e estatísticas
 * do sistema de internacionalização.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../components/i18n/LanguageProvider';
import languageAnalytics from '../services/LanguageAnalytics';

const LanguageAnalyticsScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const [analytics, setAnalytics] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = () => {
    const stats = languageAnalytics.getUsageStats();
    const report = languageAnalytics.generateReport();
    setAnalytics({ stats, report });
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadAnalytics();
    setTimeout(() => setRefreshing(false), 1000);
  };

  const exportData = () => {
    const data = languageAnalytics.exportData();
    Alert.alert(
      'Export Data',
      `Analytics data exported successfully!\n\nSession: ${data.analytics.sessionId}\nDuration: ${Math.round(data.analytics.sessionDuration / 1000)}s\nRequests: ${data.analytics.totalRequests}`,
      [{ text: 'OK' }]
    );
  };

  const clearData = () => {
    Alert.alert(
      'Clear Analytics',
      'Are you sure you want to clear all analytics data?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            languageAnalytics.clearData();
            loadAnalytics();
          }
        }
      ]
    );
  };

  const MetricCard = ({ title, value, subtitle, icon, color = '#007bff' }) => (
    <View style={styles.metricCard}>
      <View style={styles.metricHeader}>
        <Ionicons name={icon} size={24} color={color} />
        <Text style={styles.metricTitle}>{title}</Text>
      </View>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      {subtitle && <Text style={styles.metricSubtitle}>{subtitle}</Text>}
    </View>
  );

  const LanguageBar = ({ language, count, percentage, total }) => (
    <View style={styles.languageBar}>
      <View style={styles.languageInfo}>
        <Text style={styles.languageName}>{language}</Text>
        <Text style={styles.languageCount}>{count} uses</Text>
      </View>
      <View style={styles.barContainer}>
        <View 
          style={[
            styles.bar, 
            { width: `${percentage}%` }
          ]} 
        />
      </View>
      <Text style={styles.percentage}>{percentage.toFixed(1)}%</Text>
    </View>
  );

  const RecommendationCard = ({ recommendation }) => (
    <View style={[
      styles.recommendationCard,
      { borderLeftColor: recommendation.priority === 'high' ? '#dc3545' : '#ffc107' }
    ]}>
      <View style={styles.recommendationHeader}>
        <Ionicons 
          name={recommendation.priority === 'high' ? 'warning' : 'information-circle'} 
          size={20} 
          color={recommendation.priority === 'high' ? '#dc3545' : '#ffc107'} 
        />
        <Text style={styles.recommendationType}>
          {recommendation.type.replace('_', ' ').toUpperCase()}
        </Text>
      </View>
      <Text style={styles.recommendationMessage}>{recommendation.message}</Text>
    </View>
  );

  if (!analytics) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading analytics...</Text>
      </View>
    );
  }

  const { stats, report } = analytics;

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Language Analytics</Text>
        <TouchableOpacity onPress={exportData}>
          <Ionicons name="download" size={24} color="#333" />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* Métricas Principais */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Overview</Text>
          <View style={styles.metricsGrid}>
            <MetricCard
              title="Session Duration"
              value={report.summary.sessionDuration}
              icon="time-outline"
              color="#28a745"
            />
            <MetricCard
              title="Total Requests"
              value={report.summary.totalRequests}
              icon="chatbubbles-outline"
              color="#007bff"
            />
            <MetricCard
              title="Cache Hit Rate"
              value={report.summary.cacheHitRate}
              icon="flash-outline"
              color="#ffc107"
            />
            <MetricCard
              title="Missing Translations"
              value={report.summary.missingTranslations}
              icon="warning-outline"
              color="#dc3545"
            />
          </View>
        </View>

        {/* Idiomas Mais Usados */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Languages</Text>
          {report.topLanguages.map((lang, index) => (
            <LanguageBar
              key={lang.language}
              language={lang.language}
              count={lang.count}
              percentage={lang.percentage}
              total={stats.usage.totalLanguageUsage}
            />
          ))}
        </View>

        {/* Traduções Mais Solicitadas */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Translation Requests</Text>
          {report.topRequests.slice(0, 5).map((request, index) => (
            <View key={index} style={styles.requestCard}>
              <Text style={styles.requestKey}>{request.key}</Text>
              <View style={styles.requestInfo}>
                <Text style={styles.requestLanguage}>{request.language}</Text>
                <Text style={styles.requestCount}>{request.count} requests</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Traduções Faltantes */}
        {report.topMissing.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Missing Translations</Text>
            {report.topMissing.slice(0, 5).map((missing, index) => (
              <View key={index} style={styles.missingCard}>
                <Text style={styles.missingKey}>{missing.key}</Text>
                <View style={styles.missingInfo}>
                  <Text style={styles.missingLanguage}>{missing.language}</Text>
                  <Text style={styles.missingCount}>{missing.count} missing</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Recomendações */}
        {report.recommendations.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recommendations</Text>
            {report.recommendations.map((rec, index) => (
              <RecommendationCard key={index} recommendation={rec} />
            ))}
          </View>
        )}

        {/* Ações */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.clearButton} onPress={clearData}>
            <Ionicons name="trash-outline" size={20} color="#fff" />
            <Text style={styles.clearButtonText}>Clear Analytics Data</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  content: {
    padding: 20,
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    width: '48%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  metricTitle: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  metricValue: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  metricSubtitle: {
    fontSize: 10,
    color: '#999',
  },
  languageBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  languageInfo: {
    flex: 1,
  },
  languageName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  languageCount: {
    fontSize: 12,
    color: '#666',
  },
  barContainer: {
    flex: 2,
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    marginHorizontal: 10,
  },
  bar: {
    height: '100%',
    backgroundColor: '#007bff',
    borderRadius: 4,
  },
  percentage: {
    fontSize: 12,
    fontWeight: '500',
    color: '#666',
    minWidth: 40,
    textAlign: 'right',
  },
  requestCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  requestKey: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 4,
  },
  requestInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  requestLanguage: {
    fontSize: 12,
    color: '#007bff',
    fontWeight: '500',
  },
  requestCount: {
    fontSize: 12,
    color: '#666',
  },
  missingCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#dc3545',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  missingKey: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 4,
  },
  missingInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  missingLanguage: {
    fontSize: 12,
    color: '#dc3545',
    fontWeight: '500',
  },
  missingCount: {
    fontSize: 12,
    color: '#666',
  },
  recommendationCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 8,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  recommendationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  recommendationType: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#666',
  },
  recommendationMessage: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dc3545',
    padding: 15,
    borderRadius: 10,
    gap: 8,
  },
  clearButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
});

export default LanguageAnalyticsScreen;
