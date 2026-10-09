// src/ui/components/PestMap.tsx — Mapa satelital de «Ubicar plaga» (WebView con Leaflet embebido; ADR 0009).
//
// QUÉ HACE: muestra la página de src/pests/mapHtml.ts y le envía los datos cada vez que cambian (contornos de lotes,
// hileras, puntos del fundo, alertas con su color de estado, tu posición y la alerta elegida). Al tocar una alerta
// avisa con onSelect(caseId). Botones encima del mapa: «Yo» (centrar en tu posición), «Todo» (ver todo) y
// Satélite/Calles. Sin internet el mapa se dibuja igual sobre fondo oscuro (la imagen satelital necesita conexión;
// las teselas ya vistas se reutilizan desde la caché del WebView).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { FARM_CENTER, type FarmLayers, type PestReport } from '../../domain/pests';
import type { GpsFix } from '../../domain/types';
import { buildMapHtml, mapCall, mapPayload } from '../../pests/mapHtml';
import { feedback } from '../feedback';
import { S } from '../strings';
import { colors, font, radius } from '../theme';

interface Props {
  farm: FarmLayers | null;
  reports: readonly PestReport[];
  me: GpsFix | null;
  selectedId: string | null;
  onSelect: (caseId: string | null) => void;
  style?: StyleProp<ViewStyle>;
}

function MapButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        feedback('tap');
        onPress();
      }}
      style={({ pressed }) => [styles.btn, disabled && styles.btnDisabled, pressed && { opacity: 0.75 }]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

export function PestMap({ farm, reports, me, selectedId, onSelect, style }: Props) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [base, setBase] = useState<'sat' | 'calles'>('sat');
  // La página se arma una sola vez: los datos viajan con injectJavaScript (no se recarga el mapa).
  const html = useMemo(
    () => buildMapHtml({ attrSat: S.pests.attrSat, attrStreets: S.pests.attrStreets }, farm?.center ?? FARM_CENTER),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const payload = useMemo(() => mapPayload(farm, reports, me, selectedId), [farm, reports, me, selectedId]);

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(mapCall('update', payload));
  }, [ready, payload]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { type?: string; caseId?: string | null; base?: string } | null = null;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg?.type === 'ready') setReady(true);
    else if (msg?.type === 'select') onSelect(typeof msg.caseId === 'string' ? msg.caseId : null);
    else if (msg?.type === 'base') setBase(msg.base === 'calles' ? 'calles' : 'sat');
  };

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        ref={ref}
        source={{ html }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        setSupportMultipleWindows={false}
        // La página no navega a ningún sitio web (la atribución no tiene enlaces). Las teselas no son navegaciones.
        onShouldStartLoadWithRequest={(req) => !/^https?:/i.test(req.url)}
        onMessage={onMessage}
        onContentProcessDidTerminate={() => ref.current?.reload()}
        onRenderProcessGone={() => ref.current?.reload()}
        style={styles.web}
      />
      <View style={styles.tools} pointerEvents="box-none">
        <MapButton label={S.pests.centerMe} onPress={() => ref.current?.injectJavaScript(mapCall('centerMe'))} disabled={!me} />
        <MapButton label={S.pests.fitAll} onPress={() => ref.current?.injectJavaScript(mapCall('fitAll'))} />
        <MapButton
          label={base === 'sat' ? S.pests.baseStreets : S.pests.baseSat}
          onPress={() => ref.current?.injectJavaScript(mapCall('toggleBase'))}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#1b2a22' },
  web: { flex: 1, backgroundColor: '#1b2a22' },
  tools: { position: 'absolute', top: 10, right: 10, gap: 8, alignItems: 'flex-end' },
  btn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: 'rgba(14, 59, 36, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: colors.textOnDark, fontSize: font.label, fontWeight: font.weightSemi },
});
