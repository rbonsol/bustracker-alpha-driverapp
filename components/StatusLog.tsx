import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { LogEntry } from '../types';

interface StatusLogProps {
  logs: LogEntry[];
}

export const StatusLog: React.FC<StatusLogProps> = ({ logs }) => {
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [logs]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>System Log</Text>
        <View style={styles.indicator} />
      </View>
      <ScrollView ref={scrollViewRef} style={styles.scrollView}>
        {logs.length === 0 && (
          <Text style={styles.placeholder}>Waiting for trip to start...</Text>
        )}
        {logs.map((log) => (
          <View key={log.id} style={styles.logEntry}>
            <Text style={styles.timestamp}>
              {log.timestamp.getHours().toString().padStart(2, '0')}:
              {log.timestamp.getMinutes().toString().padStart(2, '0')}:
              {log.timestamp.getSeconds().toString().padStart(2, '0')}
            </Text>
            <Text
              style={[
                styles.message,
                log.type === 'error' && styles.messageError,
                log.type === 'success' && styles.messageSuccess,
                log.type === 'warning' && styles.messageWarning,
              ]}
            >
              {log.type === 'success' && '✓ '}
              {log.type === 'error' && '✕ '}
              {log.message}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderColor: '#334155',
    borderWidth: 1,
    overflow: 'hidden',
    height: 256,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#0f172a',
    borderBottomColor: '#334155',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  placeholder: {
    color: '#475569',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 12,
  },
  logEntry: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  timestamp: {
    fontSize: 12,
    color: '#475569',
    minWidth: 60,
    fontFamily: 'monospace',
  },
  message: {
    fontSize: 12,
    color: '#cbd5e1',
    flex: 1,
  },
  messageSuccess: {
    color: '#86efac',
  },
  messageError: {
    color: '#f87171',
  },
  messageWarning: {
    color: '#fbbf24',
  },
});