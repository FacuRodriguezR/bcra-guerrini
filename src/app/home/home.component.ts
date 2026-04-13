import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BcraService } from '../bcra.service';
import * as XLSX from 'xlsx';

interface ConsultaCuit {
  id?: number; // Agregado para el control de orden
  cuit: string;
  nombre: string;
  dataDeuda: any;
  abierto?: boolean;
  chequesAbierto?: boolean;
  analisis: {
    totalDeuda: number;
    maloDeuda: number;
    tieneChequesSinFondoRecientes: boolean;
    motivoRechazo: string | null;
    rechazado: boolean;
    cantidadChequesSinFondo: number;
    montoTotalChequesSinFondo: number;
    chequesParaMostrar: any[];
    esErrorValidacion?: boolean;
  } | null;
}

interface ResumenEnvio {
  cuit: string;
  status: 'viable' | 'rechazado' | 'verificar';
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  private bcraSvc = inject(BcraService);

  cuitBusqueda = '';
  cargandoMasivo = signal<boolean>(false);
  errorConsulta = signal<string | null>(null);
  mostrarDetalles = signal<boolean>(false);

  loteParaEnviar = signal<string[]>([]);
  consultasAcumuladas = signal<ConsultaCuit[]>([]);
  resumenParaExportar = signal<ResumenEnvio[]>([]);

  payloadFinal = signal<{ data: ResumenEnvio[] } | null>(null);

  // 1. AGREGAR MANUAL
  agregarCuitALote() {
    const cuitLimpio = this.cuitBusqueda.replace(/\D/g, '');

    if (cuitLimpio.length < 9 || cuitLimpio.length > 11) {
      this.errorConsulta.set("El CUIT debe tener entre 9 y 11 dígitos.");
      return;
    }

    this.loteParaEnviar.update(actual => [...actual, cuitLimpio]);
    this.cuitBusqueda = '';
    this.errorConsulta.set(null);
  }

  // 2. PROCESAR EXCEL (Solo Columna A + Validación A1)
  procesarArchivoExcel(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: any) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const matriz: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (!matriz[0] || !matriz[0][0]) {
        this.errorConsulta.set("Archivo inválido: La celda A1 debe tener datos.");
        return;
      }

      const nuevosCuits: string[] = [];
      matriz.forEach(fila => {
        const celdaA = fila[0];
        if (celdaA) {
          const cuit = String(celdaA).replace(/\D/g, '');
          if (cuit.length >= 9 && cuit.length <= 11) {
            nuevosCuits.push(cuit);
          }
        }
      });

      this.loteParaEnviar.update(prev => [...prev, ...nuevosCuits]);
      event.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  }

  // 3. CONSULTA MASIVA
  ejecutarConsultaLote() {
    const dataAEnviar = this.loteParaEnviar();
    if (dataAEnviar.length === 0) return;

    this.cargandoMasivo.set(true);

    this.bcraSvc.getDeudas({ data: dataAEnviar }).subscribe({
      next: (res) => {
        const offset = this.consultasAcumuladas().length;

        // Mapeo para la vista (Historial)
        const nuevosResultados = res.results.map((item: any, index: number) =>
          this.mapearResultado(item, index + 1 + offset)
        );

        this.consultasAcumuladas.update(prev => [...nuevosResultados, ...prev]);

        // Construcción del payload para exportación
        const listaResumen: ResumenEnvio[] = res.results.map((item: any) => {
          let estadoFinal: 'viable' | 'rechazado' | 'verificar' = 'viable';

          if (item.message) {
            estadoFinal = 'verificar';
          } else if (item.data) {
            const an = this.procesarRiesgoCompleto(item.data);
            estadoFinal = an.rechazado ? 'rechazado' : 'viable';
          } else {
            estadoFinal = 'verificar';
          }

          return {
            cuit: item.data?.identificacion?.toString() || item.id?.toString() || '0',
            status: estadoFinal
          };
        });

        this.payloadFinal.set({ data: listaResumen });

        this.loteParaEnviar.set([]);
        this.cargandoMasivo.set(false);
        this.mostrarDetalles.set(true);
      },
      error: () => this.cargandoMasivo.set(false)
    });
  }

  private mapearResultado(item: any, nuevoId: number) {
    const tituloConsulta = `CONSULTA #${nuevoId}`;

    if (item.message) {
      return {
        id: nuevoId,
        cuit: item.data?.identificacion?.toString() || item.id?.toString() || 'S/D',
        nombre: `${tituloConsulta} - Observación`,
        analisis: { motivoRechazo: item.message, esErrorValidacion: true }
      } as ConsultaCuit;
    }

    const analisis = this.procesarRiesgoCompleto(item.data);
    return {
      id: nuevoId,
      cuit: item.data?.identificacion?.toString() || item.id?.toString() || 'S/D',
      nombre: item.data?.denominacion || tituloConsulta,
      dataDeuda: { results: item.data },
      analisis: { ...analisis, esErrorValidacion: false },
      abierto: false,
      chequesAbierto: false
    } as ConsultaCuit;
  }

  descargarReporteExcel() {
    const payload = this.payloadFinal();
    if (!payload) return;

    this.cargandoMasivo.set(true);
    this.bcraSvc.enviarDatosExcel(payload).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Reporte_BCRA_${new Date().getTime()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        this.cargandoMasivo.set(false);
      },
      error: () => {
        this.cargandoMasivo.set(false);
        this.errorConsulta.set("Error al generar el archivo Excel.");
      }
    });
  }

  private procesarRiesgoCompleto(data: any) {
    let tieneChequesSinFondoRecientes = false;
    let cantidadChequesSinFondo = 0;
    let montoTotalChequesSinFondo = 0;
    const tresMesesAtras = new Date();
    tresMesesAtras.setMonth(tresMesesAtras.getMonth() - 3);
    let chequesFiltrados: any[] = [];

    if (data?.causales) {
      data.causales.forEach((c: any) => {
        c.entidades?.forEach((ent: any) => {
          const detallesRecientes = ent.detalle?.filter((det: any) => {
            const fechaRechazo = new Date(det.fechaRechazo);
            return det.fechaPago === null && fechaRechazo >= tresMesesAtras;
          }) || [];
          if (detallesRecientes.length > 0) {
            detallesRecientes.forEach((det: any) => {
              if (c.causal === "SIN FONDOS") {
                cantidadChequesSinFondo++;
                montoTotalChequesSinFondo += det.monto;
                tieneChequesSinFondoRecientes = true;
              }
            });
            chequesFiltrados.push({ entidad: ent.entidad, causal: c.causal, detalle: detallesRecientes });
          }
        });
      });
    }

    const entidades = data?.periodos?.[0]?.entidades || [];
    const totalDeuda = entidades.reduce((acc: number, e: any) => acc + (e.monto || 0), 0) * 1000;
    const deudaMala = entidades.filter((e: any) => e.situacion > 2).reduce((acc: number, e: any) => acc + (e.monto || 0), 0) * 1000;

    return {
      totalDeuda,
      maloDeuda: deudaMala,
      tieneChequesSinFondoRecientes,
      motivoRechazo: tieneChequesSinFondoRecientes ? 'Cheques impagos' : (deudaMala > (totalDeuda * 0.1) ? 'Situación irregular' : null),
      rechazado: tieneChequesSinFondoRecientes || deudaMala > (totalDeuda * 0.1),
      cantidadChequesSinFondo,
      montoTotalChequesSinFondo,
      chequesParaMostrar: chequesFiltrados
    };
  }

  enviarDatosAProcesar() {
    const payload = this.payloadFinal();
    if (payload) console.log('Enviando JSON:', JSON.stringify(payload));
  }

  quitarDelLote(index: number) {
    this.loteParaEnviar.update(actual => actual.filter((_, i) => i !== index));
  }

  toggleAccordion(index: number) {
    this.consultasAcumuladas.update(l => {
      l[index].abierto = !l[index].abierto;
      return [...l];
    });
  }

  toggleCheques(index: number, e: Event) {
    e.stopPropagation();
    this.consultasAcumuladas.update(l => {
      l[index].chequesAbierto = !l[index].chequesAbierto;
      return [...l];
    });
  }

  getSituacionClass(s: number) {
    if (s === 1) return "px-3 py-1 rounded-full text-[11px] font-bold bg-green-100 text-green-700";
    if (s === 2) return "px-3 py-1 rounded-full text-[11px] font-bold bg-yellow-100 text-yellow-700";
    return "px-3 py-1 rounded-full text-[11px] font-bold bg-red-100 text-red-700";
  }

  limpiarTodo() {
    this.consultasAcumuladas.set([]);
    this.resumenParaExportar.set([]);
    this.payloadFinal.set(null); // Botón de descarga desaparece
    this.mostrarDetalles.set(false);
  }
}