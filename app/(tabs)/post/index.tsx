import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PostScreen() {
  return (
    <SafeAreaView className="flex-1 bg-washedup-cream" edges={['top', 'bottom']}>
      <View className="flex-1 justify-center items-center">
        <Text className="text-washedup-text-dark text-xl font-semibold">Post</Text>
      </View>
    </SafeAreaView>
  );
}
