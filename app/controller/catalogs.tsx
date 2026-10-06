// app/controller/catalogs.tsx — PANT-11 Catálogos (RF-15).
//
// QUÉ HACE: muestra versión, fecha y conteos de lotes, hileras, segmentos y marcadores (con contadores
// animados). "Actualizar" requiere internet y reemplaza los catálogos de forma atómica.
// Plataforma Django: GET /api/v1/mobile/bootstrap (catálogos que se administran en la web y perfil de calidad publicado).

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppSession } from '../../src/auth/authStore';
import { catalogInfo, isCatalogOld, updateCatalogs, type CatalogInfo } from '../../src/controller/catalogService';
import { formatDateTime } from '../../src/domain/time';
import { AnimatedCounter } from '../../src/ui/components/AnimatedCounter';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { InfoRow } from '../../src/ui/components/InfoRow';
import { Screen } from '../../src/ui/components/Screen';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { messageFor } from '../../src/ui/messages';
import { S } from '../../src/ui/strings';
import { colors, font, radius } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function CatalogsScreen() {
  const online = useAppSession((s) => s.online);
  const [info, setInfo] = useState<CatalogInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void catalogInfo().then(setInfo);
    }, []),
  );

  const update = async () => {
    setBusy(true);
    const r = await updateCatalogs();
    setBusy(false);
    if (r.ok) {
      setInfo(r.info);
      showToast('CATALOGOS_ACTUALIZADOS', 'success');
    } else {
      showToast(r.code, 'error');
    }
  };

  const has = !!info && info.lots > 0;
  return (
    <Screen
      header={<AppHeader title={S.catalogs.title} back />}
      footer={<AppButton title={S.catalogs.update} onPress={update} loading={busy} disabled={!online} />}
    >
      <Card delay={40}>
        <InfoRow label={S.catalogs.version} value={info?.version ? formatDateTime(info.version) : S.catalogs.never} />
        <InfoRow
          label={S.catalogs.updatedAt}
          right={
            <StatusPill
              label={has ? formatDateTime(info?.bootstrapAt ?? null) : S.catalogs.never}
              tone={!has ? 'error' : info && isCatalogOld(info) ? 'warn' : 'ok'}
            />
          }
        />
      </Card>
      <Card delay={110}>
        <View style={styles.row}>
          <AnimatedCounter value={info?.lots ?? 0} label={S.catalogs.lots} color={colors.brand} />
          <AnimatedCounter value={info?.rows ?? 0} label={S.catalogs.rows} color={colors.brand} />
        </View>
        <View style={[styles.row, { marginTop: 16 }]}>
          <AnimatedCounter value={info?.segments ?? 0} label={S.catalogs.segments} color={colors.gold} />
          <AnimatedCounter value={info?.markers ?? 0} label={S.catalogs.markers} color={colors.gold} />
        </View>
      </Card>
      {!online ? <Text style={styles.warn}>{messageFor('SIN_INTERNET')}</Text> : null}
      {info && isCatalogOld(info) ? <Text style={styles.warn}>{messageFor('CATALOGOS_ANTIGUOS')}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  warn: {
    backgroundColor: colors.warnBg,
    padding: 12,
    borderRadius: radius.md,
    fontSize: font.body,
    color: colors.text,
    marginBottom: 10,
  },
});
