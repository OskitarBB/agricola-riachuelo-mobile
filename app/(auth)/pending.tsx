// app/(auth)/pending.tsx — PANT-04 Solicitud enviada (RF-01).
//
// QUÉ HACE: confirma que la cuenta quedó pendiente de aprobación y permite volver al login.

import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../src/ui/components/AppButton';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { Logo } from '../../src/ui/components/Logo';
import { Screen } from '../../src/ui/components/Screen';
import { S } from '../../src/ui/strings';
import { colors, font } from '../../src/ui/theme';

export default function PendingScreen() {
  return (
    <Screen scroll={false} footer={<AppButton title={S.pendingScreen.back} onPress={() => router.replace('/login')} />}>
      <View style={styles.center}>
        <Logo size={220} />
        <FadeIn delay={200} from="scale">
          <View style={styles.badge}>
            <Text style={styles.badgeText}>✓</Text>
          </View>
        </FadeIn>
        <FadeIn delay={320}>
          <Text style={styles.title}>{S.pendingScreen.title}</Text>
          <Text style={styles.body}>{S.pendingScreen.body}</Text>
        </FadeIn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  badge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.ok,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  badgeText: { color: '#fff', fontSize: 40, fontWeight: font.weightBold },
  title: { fontSize: font.title, fontWeight: font.weightBold, color: colors.text, textAlign: 'center', marginTop: 18 },
  body: { fontSize: font.body, color: colors.textMuted, textAlign: 'center', marginTop: 10, lineHeight: 23 },
});
