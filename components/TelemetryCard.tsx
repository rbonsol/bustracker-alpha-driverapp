import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface TelemetryCardProps {
  label: string;
  value: string | number;
  unit?: string;
  color?: 'default' | 'danger' | 'warning' | 'success';
}

export const TelemetryCard: React.FC<TelemetryCardProps> = ({ label, value, unit, color = 'default' }) => {
  const colorClasses = {
    default: { text: '#cbd5e1', bg: '#334155', border: '#475569' },
    danger: { text: '#f87171', bg: '#7f1d1d', border: '#991b1b' },
    warning: { text: '#fbbf24', bg: '#78350f', border: '#b45309' },
    success: { text: '#86efac', bg: '#166534', border: '#15803d' },
  };

  const c = colorClasses[color];

  return (
    <View style={[styles.card, { borderColor: c.border, backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: '#94a3b8' }]}>{label}</Text>
      </View>
      <View style={styles.content}>
        <View style={styles.valueRow}>
          <Text style={[styles.value, { color: c.text }]}>{value}</Text>
          {unit && <Text style={[styles.unit, { color: '#64748b' }]}>{unit}</Text>}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    width: '48%',
    justifyContent: 'space-between',
    minHeight: 96,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  content: {
    marginTop: 'auto',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: 10,
    fontWeight: '500',
  },
});