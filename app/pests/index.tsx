// app/pests/index.tsx — PANT-40 «Ubicar plaga» (ADR 0009; plataforma v1.3, ADR-W-007).
//
// QUÉ HACE: muestra las alertas de plaga que el encargado debe ir a ver —confirmadas por la IA o por el especialista,
// posibles plagas y casos en revisión— en un MAPA SATELITAL (contornos de lotes, hileras, puntos del fundo y tu
// posición) o en una LISTA ordenada (primero lo confirmado, luego lo más cerca). Cada alerta dice a cuántos metros y
// en qué dirección está, y abajo del mapa ofrece «Cómo llegar» con Google Maps (a pie) y «Ver detalle».
//  - Al abrir: la última copia guardada (sirve sin internet) y luego la lista nueva; se actualiza sola cada
//    pests.autoRefreshMs con internet y con «Actualizar».
//  - Para el especialista fitosanitario es su pantalla principal (Ajustes y Cerrar sesión arriba); para el operador
//    y el administrador es una pantalla secundaria («Volver»).
//  - ?focus=<caseId> (desde el detalle, «Ver en el mapa») elige esa alerta y muestra el mapa.

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { useAppSession } from '../../src/auth/authStore';
import { CONFIG } from '../../src/config';
import { filterReports, hasLocation, isConfirmed, sortReports, withDistance, type PestFilter } from '../../src/domain/pests';
import { formatTime } from '../../src/domain/time';
import { canDoFieldWork } from '../../src/domain/types';
import { openWalkingDirections } from '../../src/pests/openMaps';
import { loadPests, refreshPests, usePests, watchMyPosition } from '../../src/pests/pestService';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { ChipGroup } from '../../src/ui/components/ChipGroup';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { PestItem } from '../../src/ui/components/PestItem';
import { PestMap } from '../../src/ui/components/PestMap';
import { Screen } from '../../src/ui/components/Screen';
import { Segmented } from '../../src/ui/components/Segmented';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { S } from '../../src/ui/strings';
import { colors, font } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

type Mode = 'MAPA' | 'LISTA';

export default function PestsScreen() {
  const { user } = useAppSession();
  const field = canDoFieldWork(user?.roles);
  const { cache, loading, lastError, me, locationDenied } = usePests();
  const params = useLocalSearchParams<{ focus?: string }>();
  const [view, setView] = useState<Mode>('MAPA');
  const [filter, setFilter] = useState<PestFilter>('TODAS');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // «Ver en el mapa» desde el detalle: se ajusta el estado durante el render (sin efecto) cuando cambia ?focus.
  const focus = typeof params.focus === 'string' && params.focus ? params.focus : null;
  const [seenFocus, setSeenFocus] = useState<string | null>(null);
  if (focus && focus !== seenFocus) {
    setSeenFocus(focus);
    setSelectedId(focus);
    setView('MAPA');
  }

  // Al entrar: copia guardada → lista nueva; GPS propio de la pantalla; actualización periódica con internet.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let stopGps: (() => void) | null = null;
      void loadPests().then(() => (alive ? refreshPests() : undefined));
      void watchMyPosition().then((stop) => {
        if (alive) stopGps = stop;
        else stop();
      });
      const timer = setInterval(() => {
        if (useAppSession.getState().online) void refreshPests();
      }, CONFIG.pests.autoRefreshMs);
      return () => {
        alive = false;
        stopGps?.();
        clearInterval(timer);
      };
    }, []),
  );

  const all = useMemo(() => cache?.data.reports ?? [], [cache]);
  const reports = useMemo(() => sortReports(withDistance(filterReports(all, filter), me)), [all, filter, me]);
  const selected = reports.find((r) => r.caseId === selectedId) ?? null;
  const days = cache?.data.days ?? CONFIG.pests.windowDays;
  const counts = useMemo(
    () => ({
      all: all.length,
      confirmed: all.filter((r) => isConfirmed(r.status)).length,
      possible: all.length - all.filter((r) => isConfirmed(r.status)).length,
    }),
    [all],
  );

  const refresh = async () => {
    const r = await refreshPests();
    if (r.ok) showToast('ALERTAS_ACTUALIZADAS', 'success');
    else if (r.code === 'SIN_INTERNET' && cache) showToast('ALERTAS_DE_COPIA', 'warn');
    else showToast(r.code, 'warn');
  };

  const goTo = async (lat: number, lon: number, caseId: string) => {
    const ok = await openWalkingDirections(lat, lon, caseId);
    if (!ok) showToast('MAPS_NO_DISPONIBLE', 'error');
  };

  const status = [
    cache ? S.pests.updatedAt(formatTime(cache.fetchedAt)) : S.pests.neverUpdated,
    lastError && lastError !== 'REAUTENTICACION_REQUERIDA' ? messageFor(lastError) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const header = <AppHeader title={S.pests.title} main={!field} back={field} />;

  const controls = (
    <>
      {!field ? (
        <FadeIn>
          <Text style={styles.note}>{S.pests.specialistNote}</Text>
        </FadeIn>
      ) : null}
      <Segmented<Mode>
        options={[
          { value: 'MAPA', label: S.pests.viewMap },
          { value: 'LISTA', label: S.pests.viewList },
        ]}
        value={view}
        onChange={setView}
      />
      <View style={styles.row}>
        <ChipGroup<PestFilter>
          options={[
            { value: 'TODAS', label: `${S.pests.filterAll} ${counts.all}` },
            { value: 'CONFIRMADAS', label: `${S.pests.filterConfirmed} ${counts.confirmed}` },
            { value: 'POSIBLES', label: `${S.pests.filterPossible} ${counts.possible}` },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>
      <View style={styles.statusRow}>
        <Text style={styles.status} numberOfLines={2}>
          {status}
        </Text>
        <AppButton title={S.pests.refresh} variant="secondary" compact loading={loading} onPress={refresh} />
      </View>
      {locationDenied ? (
        <Card tone="warn">
          <Text style={styles.body}>{messageFor('UBICACION_SIN_PERMISO')}</Text>
          <AppButton title={S.pests.allowLocation} variant="secondary" compact onPress={() => void Linking.openSettings()} />
        </Card>
      ) : null}
    </>
  );

  const empty =
    all.length === 0 ? (
      <Card>
        <Text style={styles.body}>{cache ? S.pests.empty(days) : status}</Text>
      </Card>
    ) : reports.length === 0 ? (
      <Card>
        <Text style={styles.body}>{S.pests.emptyFilter}</Text>
      </Card>
    ) : null;

  if (view === 'LISTA') {
    return (
      <Screen header={header}>
        {controls}
        <View style={styles.gap} />
        {empty}
        {reports.map((r, i) => (
          <FadeIn key={r.caseId} delay={Math.min(i, 8) * 40}>
            <PestItem report={r} hasMe={!!me} onPress={() => router.push(`/pests/${r.caseId}`)} />
          </FadeIn>
        ))}
      </Screen>
    );
  }

  return (
    <Screen header={header} scroll={false}>
      {controls}
      {/* La alerta elegida se muestra ENCIMA del mapa (abajo) para no achicarlo en celulares pequeños. */}
      <View style={styles.flex}>
        <PestMap
          farm={cache?.data.farm ?? null}
          reports={reports}
          me={me}
          selectedId={selectedId}
          onSelect={(id) => {
            if (id) feedback('tap');
            setSelectedId(id);
          }}
        />
        {selected ? (
          <View style={styles.sheet} pointerEvents="box-none">
            <PestItem report={selected} hasMe={!!me} selected>
              <View style={styles.actions}>
                {hasLocation(selected) ? (
                  <AppButton
                    title={S.pests.howToGo}
                    compact
                    style={styles.flex}
                    onPress={() => goTo(selected.lat as number, selected.lon as number, selected.caseId)}
                  />
                ) : null}
                <AppButton
                  title={S.pests.detail}
                  variant="secondary"
                  compact
                  style={styles.flex}
                  onPress={() => router.push(`/pests/${selected.caseId}`)}
                />
              </View>
            </PestItem>
          </View>
        ) : empty ? (
          <View style={styles.sheet} pointerEvents="box-none">
            {empty}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { height: 4 },
  note: { fontSize: font.body, color: colors.textMuted, marginBottom: 10 },
  row: { marginTop: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 10 },
  status: { flex: 1, fontSize: font.label, color: colors.textMuted },
  body: { fontSize: font.body, color: colors.text, marginBottom: 6 },
  // bottom: deja ver la atribución de las imágenes (obligatoria) debajo de la tarjeta.
  sheet: { position: 'absolute', left: 8, right: 8, bottom: 22 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
});
