// app/gallery.tsx — Fotos guardadas en este celular (pedido del equipo).
//
// QUÉ HACE: cuadrícula animada con las fotos del almacenamiento privado (evidencia de sesión, prueba corta y
// modo prueba), con filtros. Al tocar una foto se abre el visor a pantalla completa: se desliza entre fotos
// (paginado horizontal) y muestra su ficha (calidad, métricas, rol, transferencia). Se puede compartir una
// foto y borrar SOLO las fotos de prueba (las de evidencia están protegidas por RN-09).

import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Dimensions, FlatList, Modal, Pressable, StyleSheet, Text, View, useAnimatedValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDateTime } from '../src/domain/time';
import {
  deleteTestPhotos,
  listPhotos,
  photoDetails,
  sharePhoto,
  type PhotoDetails,
  type PhotoKind,
  type StoredPhoto,
} from '../src/device/galleryService';
import { AppButton } from '../src/ui/components/AppButton';
import { AppHeader } from '../src/ui/components/AppHeader';
import { confirm } from '../src/ui/components/ConfirmDialog';
import { FadeIn } from '../src/ui/components/FadeIn';
import { Segmented } from '../src/ui/components/Segmented';
import { StatusPill } from '../src/ui/components/StatusPill';
import { feedback } from '../src/ui/feedback';
import { QUALITY_LABEL, ROLE_LABEL, S } from '../src/ui/strings';
import { colors, font, qualityTone, radius } from '../src/ui/theme';
import { showToast } from '../src/ui/toast';

type Filter = 'ALL' | PhotoKind;
const COLS = 3;
const GAP = 6;

function Thumb({ photo, size, index, onPress }: { photo: StoredPhoto; size: number; index: number; onPress: () => void }) {
  const s = useAnimatedValue(1);
  return (
    <FadeIn delay={Math.min(index, 18) * 30} from="scale">
      <Animated.View style={{ transform: [{ scale: s }] }}>
        <Pressable
          onPressIn={() => Animated.spring(s, { toValue: 0.92, useNativeDriver: true, speed: 40, bounciness: 0 }).start()}
          onPressOut={() => Animated.spring(s, { toValue: 1, useNativeDriver: true, bounciness: 10 }).start()}
          onPress={onPress}
        >
          <Image
            source={{ uri: photo.uri }}
            style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: colors.cardAlt }}
            contentFit="cover"
            transition={200}
          />
          {photo.kind !== 'SESSION' ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{photo.kind === 'TEST' ? S.gallery.filterTest : S.gallery.filterShort}</Text>
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    </FadeIn>
  );
}

export default function GalleryScreen() {
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [viewer, setViewer] = useState<number | null>(null);
  const [details, setDetails] = useState<PhotoDetails | null>(null);
  const width = Dimensions.get('window').width;
  const size = (width - 32 - GAP * (COLS - 1)) / COLS;

  const load = useCallback(() => setPhotos(listPhotos()), []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const visible = useMemo(() => (filter === 'ALL' ? photos : photos.filter((p) => p.kind === filter)), [photos, filter]);

  useEffect(() => {
    let alive = true;
    const item = viewer === null ? undefined : visible[viewer];
    void (item ? photoDetails(item) : Promise.resolve(null)).then((d) => alive && setDetails(d));
    return () => {
      alive = false;
    };
  }, [viewer, visible]);

  const removeTests = async () => {
    const ok = await confirm({
      title: S.gallery.deleteTest,
      message: S.gallery.deleteTestConfirm,
      confirmText: S.gallery.deleteTest,
      danger: true,
    });
    if (!ok) return;
    const n = deleteTestPhotos();
    showToast(S.gallery.deleted(n), 'success');
    load();
  };

  const current = viewer !== null ? visible[viewer] : null;

  return (
    <View style={styles.flex}>
      <AppHeader title={S.gallery.title} back />
      <View style={styles.filters}>
        <Segmented<Filter>
          options={[
            { value: 'ALL', label: S.gallery.filterAll },
            { value: 'SESSION', label: S.gallery.filterSession },
            { value: 'TEST', label: S.gallery.filterTest },
            { value: 'SHORT_TEST', label: S.gallery.filterShortTab },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>
      <FlatList
        data={visible}
        key={filter}
        numColumns={COLS}
        keyExtractor={(p) => p.uri}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ padding: 16, gap: GAP, paddingBottom: insets.bottom + 90 }}
        ListEmptyComponent={
          <FadeIn>
            <Text style={styles.empty}>{S.gallery.empty}</Text>
          </FadeIn>
        }
        renderItem={({ item, index }) => (
          <Thumb
            photo={item}
            size={size}
            index={index}
            onPress={() => {
              feedback('tap');
              setViewer(index);
            }}
          />
        )}
      />
      {photos.some((p) => p.kind === 'TEST') ? (
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
          <AppButton title={S.gallery.deleteTest} variant="secondary" onPress={removeTests} />
        </View>
      ) : null}

      <Modal visible={viewer !== null} animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewer}>
          <FlatList
            data={visible}
            horizontal
            pagingEnabled
            initialScrollIndex={viewer ?? 0}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(p) => p.uri}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setViewer(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => <Image source={{ uri: item.uri }} style={{ width, height: '100%' }} contentFit="contain" />}
          />
          <View style={[styles.viewerTop, { paddingTop: insets.top + 8 }]}>
            <AppButton title={S.close} variant="dark" compact onPress={() => setViewer(null)} />
            <Text style={styles.counter}>{viewer !== null ? S.gallery.of(viewer + 1, visible.length) : ''}</Text>
            {current ? (
              <AppButton title={S.gallery.share} variant="gold" compact onPress={() => void sharePhoto(current.uri)} />
            ) : (
              <View />
            )}
          </View>
          {current ? (
            <FadeIn key={current.uri} from="bottom" style={[styles.info, { paddingBottom: insets.bottom + 14 }]}>
              <View style={styles.infoRow}>
                {details?.quality ? (
                  <StatusPill label={QUALITY_LABEL[details.quality]} tone={qualityTone(details.quality)} big />
                ) : null}
                {details?.role ? <Text style={styles.infoText}>{ROLE_LABEL[details.role]}</Text> : null}
              </View>
              <Text style={styles.infoText}>
                {formatDateTime(
                  details?.capturedAt ?? new Date(current.modifiedAt * (current.modifiedAt < 1e12 ? 1000 : 1)).toISOString(),
                )}
              </Text>
              {details?.metrics ? (
                <Text style={styles.infoMuted}>
                  {S.camera.luminance} {details.metrics.luminanceMean} · {S.camera.sharpness} {details.metrics.laplacianVariance}{' '}
                  · {details.metrics.durationMs} ms
                </Text>
              ) : null}
            </FadeIn>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  filters: { paddingHorizontal: 16, paddingTop: 14 },
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: font.body, marginTop: 60 },
  badge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(14,59,36,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: font.weightSemi },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: colors.bg,
  },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  counter: { color: '#fff', fontSize: font.body, fontWeight: font.weightSemi },
  info: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)', padding: 16, gap: 6 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  infoText: { color: '#fff', fontSize: font.body, fontWeight: font.weightMedium },
  infoMuted: { color: '#CFD8D2', fontSize: 15 },
});
