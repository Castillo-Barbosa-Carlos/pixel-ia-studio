/**
/**
 * Selector de color interactivo para Pixel-IA Studio.
 * Incluye:
 * - Área 2D de Saturación / Valor interactiva con puntero arrastrable.
 * - Slider de Tono (Hue) 0-360° con gradiente arcoíris.
 * - Slider de Transparencia (Alpha) 0-255.
 * - Entrada HEX con validación en tiempo real (data-testid="color-hex").
 * - Campos numéricos RGB y HSV sincronizados.
 * - Acceso al selector nativo del sistema con cuentagotas (<input type="color">).
 * - Paleta de 16 colores base rápidos para pixel art.
 * - Comparativa visual de color original vs nuevo.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  clamp,
  clampInt,
  colorToHexAlpha,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  hsvToRgb,
  parseHexColor,
  rgbToHsv,
} from '../core/color.ts';
import type { PaletteColor } from '../types/index.ts';
import { Icon } from './Icons.tsx';

export interface ColorPickerProps {
  initial: PaletteColor;
  onChange?: (color: PaletteColor) => void;
  onSubmit?: (color: PaletteColor) => void;
  submitLabel?: string;
  testId?: string;
}

const PRESET_COLORS = [
  '#000000', '#ffffff', '#22252a', '#4b5563', '#9ca3af', '#e5e7eb',
  '#dc2626', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#ec4899', '#78350f', '#0f766e',
];

export function ColorPicker({
  initial,
  onChange,
  onSubmit,
  submitLabel = 'Guardar color',
  testId,
}: ColorPickerProps): JSX.Element {
  const [hsv, setHsv] = useState<[number, number, number]>(() => {
    return hexToHsv(initial.hex);
  });
  const [alpha, setAlpha] = useState<number>(initial.alpha);
  const [hexInput, setHexInput] = useState<string>(() => colorToHexAlpha(initial));

  const [h, s, v] = hsv;
  const [r, g, b] = hsvToRgb(h, s, v);
  const currentHex = hsvToHex(h, s, v);
  const parsedHex = parseHexColor(hexInput);
  const isValidHex = parsedHex !== null;

  const svAreaRef = useRef<HTMLDivElement | null>(null);
  const isDraggingSv = useRef(false);

  const notifyChange = useCallback(
    (nextHex: string, nextAlpha: number) => {
      onChange?.({ hex: nextHex, alpha: nextAlpha });
    },
    [onChange],
  );

  const updateFromHsv = useCallback(
    (newH: number, newS: number, newV: number, newAlpha = alpha) => {
      const clampedH = ((newH % 360) + 360) % 360;
      const clampedS = clamp(newS, 0, 100);
      const clampedV = clamp(newV, 0, 100);
      setHsv([clampedH, clampedS, clampedV]);
      const hex = hsvToHex(clampedH, clampedS, clampedV);
      const fullHex = newAlpha >= 255 ? hex : `${hex}${newAlpha.toString(16).padStart(2, '0')}`;
      setHexInput(fullHex);
      notifyChange(hex, newAlpha);
    },
    [alpha, notifyChange],
  );

  const updateFromRgb = useCallback(
    (newR: number, newG: number, newB: number) => {
      const [newH, newS, newV] = rgbToHsv(newR, newG, newB);
      updateFromHsv(newH, newS, newV);
    },
    [updateFromHsv],
  );

  const updateFromHex = useCallback(
    (val: string) => {
      setHexInput(val);
      const parsed = parseHexColor(val);
      if (parsed) {
        const [newH, newS, newV] = hexToHsv(parsed.hex);
        setHsv([newH, newS, newV]);
        setAlpha(parsed.alpha);
        notifyChange(parsed.hex, parsed.alpha);
      }
    },
    [notifyChange],
  );

  // Arrastre en el área 2D de Saturación / Valor
  const handleSvMove = useCallback(
    (clientX: number, clientY: number) => {
      const area = svAreaRef.current;
      if (!area) return;
      const rect = area.getBoundingClientRect();
      const x = clamp(clientX - rect.left, 0, rect.width);
      const y = clamp(clientY - rect.top, 0, rect.height);
      const newS = Math.round((x / rect.width) * 100);
      const newV = Math.round((1 - y / rect.height) * 100);
      updateFromHsv(h, newS, newV);
    },
    [h, updateFromHsv],
  );

  const handleSvMouseDown = (e: ReactMouseEvent) => {
    isDraggingSv.current = true;
    handleSvMove(e.clientX, e.clientY);
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isDraggingSv.current) {
        e.preventDefault();
        handleSvMove(e.clientX, e.clientY);
      }
    };
    const onMouseUp = () => {
      isDraggingSv.current = false;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [handleSvMove]);

  const currentColorStyle = `rgba(${r}, ${g}, ${b}, ${(alpha / 255).toFixed(3)})`;
  const [initR, initG, initB] = hexToRgb(initial.hex);
  const initialColorStyle = `rgba(${initR}, ${initG}, ${initB}, ${(initial.alpha / 255).toFixed(3)})`;

  return (
    <div className="color-picker" data-testid={testId}>
      {/* Área 2D de Saturación / Brillo */}
      <div
        className="color-picker__sv"
        ref={svAreaRef}
        onMouseDown={handleSvMouseDown}
        style={{
          background: `linear-gradient(to top, #000 0%, transparent 100%), linear-gradient(to right, #fff 0%, hsl(${h}, 100%, 50%) 100%)`,
        }}
        title="Arrastra para ajustar saturación y brillo"
      >
        <div
          className="color-picker__sv-handle"
          style={{
            left: `${s}%`,
            top: `${100 - v}%`,
            background: currentColorStyle,
          }}
        />
      </div>

      {/* Sliders de Tono (Hue) y Alfa */}
      <div className="color-picker__sliders">
        <div className="color-picker__slider-row">
          <span className="color-picker__slider-label">Tono</span>
          <input
            type="range"
            min={0}
            max={360}
            value={h}
            onChange={(e) => updateFromHsv(Number(e.target.value), s, v)}
            className="color-picker__hue-bar"
            title="Tono cromático (0° - 360°)"
          />
          <b className="color-picker__slider-val">{h}°</b>
        </div>

        <div className="color-picker__slider-row">
          <span className="color-picker__slider-label">Alfa</span>
          <input
            type="range"
            min={0}
            max={255}
            value={alpha}
            onChange={(e) => {
              const a = Number(e.target.value);
              setAlpha(a);
              const hex = hsvToHex(h, s, v);
              const fullHex = a >= 255 ? hex : `${hex}${a.toString(16).padStart(2, '0')}`;
              setHexInput(fullHex);
              notifyChange(hex, a);
            }}
            className="color-picker__alpha-bar"
            style={{
              background: `linear-gradient(to right, transparent, rgb(${r}, ${g}, ${b}))`,
            }}
            title="Transparencia / Opacidad (0 - 255)"
          />
          <b className="color-picker__slider-val">{alpha}</b>
        </div>
      </div>

      {/* Vista previa comparativa y Cuentagotas nativo */}
      <div className="color-picker__compare-row">
        <div className="color-picker__split-preview" title="Izquierda: Original · Derecha: Nuevo">
          <span className="color-picker__swatch-half" style={{ background: initialColorStyle }} />
          <span className="color-picker__swatch-half" style={{ background: currentColorStyle }} />
        </div>

        <label className="color-picker__native-btn" title="Abrir selector nativo del sistema con cuentagotas">
          <Icon name="eyedropper" size={14} />
          <span>Sistema</span>
          <input
            type="color"
            value={currentHex}
            onChange={(e) => updateFromHex(e.target.value)}
            style={{ opacity: 0, position: 'absolute', pointerEvents: 'none', width: 0, height: 0 }}
          />
        </label>
      </div>

      {/* Entrada HEX principal (soporta data-testid="color-hex" para tests existentes) */}
      <div className="field-row" style={{ marginTop: 8 }}>
        <label className="field" style={{ flex: 1 }}>
          <span>HEX / HexAlpha</span>
          <input
            type="text"
            value={hexInput}
            onChange={(e) => updateFromHex(e.target.value)}
            placeholder="#ff8800"
            data-testid="color-hex"
          />
        </label>
      </div>

      {/* Campos numéricos compactos RGB y HSV */}
      <div className="color-picker__num-grid">
        <label className="color-picker__num-field">
          <span>R</span>
          <input
            type="number"
            min={0}
            max={255}
            value={r}
            onChange={(e) => updateFromRgb(clampInt(Number(e.target.value), 0, 255), g, b)}
          />
        </label>
        <label className="color-picker__num-field">
          <span>G</span>
          <input
            type="number"
            min={0}
            max={255}
            value={g}
            onChange={(e) => updateFromRgb(r, clampInt(Number(e.target.value), 0, 255), b)}
          />
        </label>
        <label className="color-picker__num-field">
          <span>B</span>
          <input
            type="number"
            min={0}
            max={255}
            value={b}
            onChange={(e) => updateFromRgb(r, g, clampInt(Number(e.target.value), 0, 255))}
          />
        </label>
        <label className="color-picker__num-field">
          <span>H°</span>
          <input
            type="number"
            min={0}
            max={360}
            value={h}
            onChange={(e) => updateFromHsv(Number(e.target.value), s, v)}
          />
        </label>
        <label className="color-picker__num-field">
          <span>S%</span>
          <input
            type="number"
            min={0}
            max={100}
            value={s}
            onChange={(e) => updateFromHsv(h, Number(e.target.value), v)}
          />
        </label>
        <label className="color-picker__num-field">
          <span>V%</span>
          <input
            type="number"
            min={0}
            max={100}
            value={v}
            onChange={(e) => updateFromHsv(h, s, Number(e.target.value))}
          />
        </label>
      </div>

      {/* Paleta rápida de 16 tonos base para pixel art */}
      <div className="color-picker__presets">
        <span className="color-picker__presets-title">Colores rápidos:</span>
        <div className="color-picker__presets-grid">
          {PRESET_COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              className="color-picker__preset-swatch"
              style={{ background: hex }}
              title={hex}
              onClick={() => updateFromHex(hex)}
            />
          ))}
        </div>
      </div>

      {!isValidHex && <p className="alert alert--error" style={{ marginTop: 6 }}>Color HEX no válido.</p>}

      {/* Botón de confirmación / guardado (data-testid="color-save" para compatibilidad) */}
      {onSubmit && (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn--accent"
            disabled={!isValidHex}
            onClick={() => {
              if (parsedHex) {
                onSubmit({ hex: parsedHex.hex, alpha });
              }
            }}
            data-testid="color-save"
          >
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}
