import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BcraService } from '../bcra.service';
import * as XLSX from 'xlsx';

interface ConsultaCuit {
  id?: number;
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
  motivo: string;
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

  hayErrorStatus = signal<boolean>(false);
  cuitsFallidos = signal<string[]>([]);

  loteParaEnviar = signal<string[]>([]);
  consultasAcumuladas = signal<ConsultaCuit[]>([]);
  payloadFinal = signal<{ data: ResumenEnvio[] } | null>(null);

  agregarCuitALote() {
    const cuitLimpio = this.cuitBusqueda.replace(/\D/g, '');
    if (cuitLimpio.length < 7 || cuitLimpio.length > 13) {
      this.errorConsulta.set("El CUIT debe tener entre 9 y 11 dígitos.");
      return;
    }
    this.loteParaEnviar.update(actual => [...actual, cuitLimpio]);
    this.cuitBusqueda = '';
    this.errorConsulta.set(null);
  }

  procesarArchivoExcel(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: any) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const matriz: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      const filasConDatos = matriz.filter(fila => fila[0] !== undefined && fila[0] !== null && String(fila[0]).trim() !== "");

      if (filasConDatos.length > 25) {
        this.errorConsulta.set("El archivo solo puede contener hasta 25 CUITs.");
        event.target.value = '';
        return;
      }

      const nuevosCuits: string[] = [];
      filasConDatos.forEach(fila => {
        const cuit = String(fila[0]).replace(/\D/g, '');
        if (cuit.length >= 7 && cuit.length <= 15) {
          nuevosCuits.push(cuit);
        }
      });

      this.loteParaEnviar.update(prev => [...prev, ...nuevosCuits]);
      event.target.value = '';
      this.errorConsulta.set(null);
    };
    reader.readAsArrayBuffer(file);
  }

  ejecutarConsultaLote() {
    const dataAEnviar = this.loteParaEnviar();
    if (dataAEnviar.length === 0) return;

    this.cargandoMasivo.set(true);
    this.hayErrorStatus.set(false);
    this.consultasAcumuladas.set([]);
    this.payloadFinal.set(null);

    this.bcraSvc.getDeudas({ data: dataAEnviar }).subscribe({
      next: (res) => {
        if (res.status === false) {
          this.hayErrorStatus.set(true);
          this.cuitsFallidos.set(dataAEnviar);
        }

        const nuevosResultados = res.results.map((item: any, index: number) =>
          this.mapearResultado(item, index + 1)
        );

        this.consultasAcumuladas.set(nuevosResultados);

        const listaResumen: ResumenEnvio[] = res.results.map((item: any) => {
          let estadoFinal: 'viable' | 'rechazado' | 'verificar' = 'viable';
          let motivoTexto = 'Cumple con los parámetros de riesgo';

          const esErrorTecnico = item.message && item.message.toLowerCase().includes('error');
          const estaLimpio = !item.data || (!item.data.denominacion && !item.data.periodos);

          if (esErrorTecnico) {
            estadoFinal = 'verificar';
            motivoTexto = 'Error de conexión: ' + item.message;
          } else if (estaLimpio) {
            estadoFinal = 'viable';
            motivoTexto = 'Sin historial crediticio';
          } else {
            const an = this.procesarRiesgoCompleto(item.data);
            if (an.rechazado) {
              estadoFinal = 'rechazado';
              motivoTexto = an.motivoRechazo || 'Riesgo elevado';
            }
          }

          return {
            cuit: item.data?.identificacion?.toString() || item.cuit || '0',
            status: estadoFinal,
            motivo: motivoTexto
          };
        });

        this.payloadFinal.set({ data: listaResumen });
        this.loteParaEnviar.set([]);
        this.cargandoMasivo.set(false);

        if (res.status !== false) {
          this.mostrarDetalles.set(true);
        }
      },
      error: () => {
        this.cargandoMasivo.set(false);
        this.errorConsulta.set("Error de comunicación.");
      }
    });
  }

  private mapearResultado(item: any, nuevoId: number) {
    const estaLimpio = !item.data || (!item.data.denominacion && !item.data.periodos);
    const esErrorTecnico = item.message && item.message.toLowerCase().includes('error');

    if (esErrorTecnico) {
      return {
        id: nuevoId,
        cuit: item.data.identificacion?.toString() || 'S/D',
        nombre: 'Error de consulta',
        analisis: { motivoRechazo: item.message, esErrorValidacion: true, rechazado: false }
      } as any;
    }

    if (estaLimpio) {
      return {
        id: nuevoId,
        cuit: item.data.identificacion?.toString() || 'S/D',
        nombre: 'Sin historial crediticio',
        dataDeuda: null,
        analisis: {
          motivoRechazo: 'Sin historial (Limpio)',
          esErrorValidacion: false,
          rechazado: false,
          totalDeuda: 0,
          maloDeuda: 0,
          chequesParaMostrar: []
        },
        abierto: false
      } as any;
    }

    const analisis = this.procesarRiesgoCompleto(item.data);
    return {
      id: nuevoId,
      cuit: item.data.identificacion?.toString(),
      nombre: item.data.denominacion,
      dataDeuda: { results: item.data },
      analisis: { ...analisis, esErrorValidacion: false },
      abierto: false,
      chequesAbierto: false
    } as ConsultaCuit;
  }

  private procesarRiesgoCompleto(data: any) {
    let tieneChequesSinFondoRecientes = false;
    let cantidadChequesSinFondo = 0;
    let montoTotalChequesSinFondo = 0;
    const tresMesesAtras = new Date();
    tresMesesAtras.setMonth(tresMesesAtras.getMonth() - 3);
    let chequesFiltrados: any[] = [];

    // 1. Procesamiento de Cheques
    if (data?.causales) {
      data.causales.forEach((c: any) => {
        c.entidades?.forEach((ent: any) => {
          const detallesRecientes = ent.detalle?.filter((det: any) => {
            const fechaRechazo = new Date(det.fechaRechazo);
            return det.fechaPago === null && fechaRechazo >= tresMesesAtras;
          }) || [];
          detallesRecientes.forEach((det: any) => {
            if (c.causal === "SIN FONDOS") {
              cantidadChequesSinFondo++;
              montoTotalChequesSinFondo += det.monto;
              tieneChequesSinFondoRecientes = true;
            }
          });
          if (detallesRecientes.length > 0) {
            chequesFiltrados.push({ entidad: ent.entidad, causal: c.causal, detalle: detallesRecientes });
          }
        });
      });
    }

    // 2. Procesamiento de Deuda y Situación Máxima
    const entidades = data?.periodos?.[0]?.entidades || [];
    let situacionMaxima = 0;
    let deudaIrregularTotal = 0;
    const totalDeudaGeneral = entidades.reduce((acc: number, e: any) => acc + (e.monto || 0), 0) * 1000;

    entidades.forEach((e: any) => {
      if (e.situacion > situacionMaxima) situacionMaxima = e.situacion;
      if (e.situacion > 2) {
        deudaIrregularTotal += (e.monto || 0) * 1000;
      }
    });

    const tieneDeudaIrregularSignificativa = deudaIrregularTotal > (totalDeudaGeneral * 0.1);
    let motivosArray: string[] = [];

    if (tieneChequesSinFondoRecientes) {
      motivosArray.push("Cheques Sin Fondos detectados (últimos 3 meses)");
    }

    if (tieneDeudaIrregularSignificativa) {
      const deudaFormateada = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(deudaIrregularTotal);
      motivosArray.push(`Situación Crediticia Máxima ${situacionMaxima} (Monto Sit>2 ${deudaFormateada})`);
    }

    return {
      totalDeuda: totalDeudaGeneral,
      maloDeuda: deudaIrregularTotal,
      tieneChequesSinFondoRecientes,
      motivoRechazo: motivosArray.length > 0 ? motivosArray.join(" y ") : null,
      rechazado: tieneChequesSinFondoRecientes || tieneDeudaIrregularSignificativa,
      cantidadChequesSinFondo,
      montoTotalChequesSinFondo,
      chequesParaMostrar: chequesFiltrados
    };
  }

  reintentarLote() {
    this.loteParaEnviar.set(this.cuitsFallidos());
    this.hayErrorStatus.set(false);
    this.ejecutarConsultaLote();
  }

  verLoCapturado() {
    this.hayErrorStatus.set(false);
    this.mostrarDetalles.set(true);
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
        a.click();
        this.cargandoMasivo.set(false);
      },
      error: () => this.cargandoMasivo.set(false)
    });
  }

  limpiarTodo() {
    this.consultasAcumuladas.set([]);
    this.payloadFinal.set(null);
    this.mostrarDetalles.set(false);
    this.hayErrorStatus.set(false);
    this.loteParaEnviar.set([]);
  }
}