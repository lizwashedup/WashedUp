import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MapPin } from 'lucide-react-native';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

interface Props {
  children: React.ReactNode;
  onClose?: () => void;
}

interface State {
  hasError: boolean;
}

export class MapErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (__DEV__) console.warn('[MapErrorBoundary]', error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <MapPin size={40} color={Colors.terracotta} />
          <Text style={styles.title}>Map unavailable</Text>
          <Text style={styles.subtitle}>
            Maps require a development build. Switch to list view to browse.
          </Text>
          {this.props.onClose && (
            <TouchableOpacity style={styles.button} onPress={this.props.onClose}>
              <Text style={styles.buttonText}>Back to List</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    marginTop: 8,
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
  },
  buttonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.white,
  },
});
