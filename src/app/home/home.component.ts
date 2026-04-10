import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BcraService } from '../bcra.service';
import { catchError, delay, of } from 'rxjs';
import * as XLSX from 'xlsx';
import { CuitProcesado } from '../model/client-model';

interface ConsultaCuit {
  cuit: string;
  nombre: string;
  dataDeuda: any;
  dataCheques: any;
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
    esErrorValidacion?: boolean; // Flag para el estado amarillo
  } | null;
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

  // Estados de UI
  cuitBusqueda = '';
  cargandoManual = signal<boolean>(false);
  cargandoMasivo = signal<boolean>(false);
  errorConsulta = signal<string | null>(null);
  mostrarDetalles = signal<boolean>(false);

  // Almacenamiento
  consultasAcumuladas = signal<ConsultaCuit[]>([]);
  loteParaEnviar = signal<CuitProcesado | null>(null);

  // --- CARGA MASIVA (EXCEL) ---

  procesarArchivoExcel(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: any) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const matriz: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      const listaTemporal: { id: number; cuit: string }[] = [];
      let indice = 1;
      const cuitsVistos = new Set<string>();

      matriz.forEach((fila) => {
        fila.forEach((celda) => {
          if (celda) {
            const valorLimpio = String(celda).replace(/\D/g, '');
            if (valorLimpio.length > 0 && !cuitsVistos.has(valorLimpio)) {
              cuitsVistos.add(valorLimpio);
              listaTemporal.push({ id: indice++, cuit: valorLimpio });
            }
          }
        });
      });

      this.loteParaEnviar.set({ data: listaTemporal });
    };
    reader.readAsArrayBuffer(file);
  }

  ejecutarConsultaMasiva() {
    const payload = this.loteParaEnviar();
    if (!payload || payload.data.length === 0) return;

    this.cargandoMasivo.set(true);
    this.errorConsulta.set(null);

    this.bcraSvc.getDeudas(payload).subscribe({
      next: (res) => {
        console.log('Respuesta recibida:', res);

        const procesados = res.results.map((item: any) => {
          // 1. CASO AMARILLO: Mensaje de error explícito del backend
          if (item.message) {
            return {
              cuit: `ID #${item.id}`,
              nombre: 'Error de validación',
              analisis: {
                motivoRechazo: item.message,
                esErrorValidacion: true
              }
            };
          }

          // 2. CASO DATA: Verificamos que 'data' exista y tenga identificación
          if (item.data && item.data.identificacion) {
            const analisis = this.procesarRiesgoCompleto(item.data);
            return {
              cuit: item.data.identificacion.toString(),
              nombre: item.data.denominacion || 'SIN DENOMINACIÓN',
              dataDeuda: { results: item.data },
              dataCheques: { results: item.data },
              analisis: { ...analisis, esErrorValidacion: false },
              abierto: false,
              chequesAbierto: false
            };
          }

          // 3. CASO DATA NULA: (Como tus IDs 13, 21, 26, 27, 30 del JSON)
          // Si viene data pero todo es null, lo tratamos como una observación (Amarillo)
          return {
            cuit: `ID #${item.id}`,
            nombre: 'Sin información disponible',
            analisis: {
              motivoRechazo: "El BCRA no retornó datos para este CUIT",
              esErrorValidacion: true
            }
          };
        });

        // Actualizamos el signal con los datos procesados
        this.consultasAcumuladas.set(procesados);

        // IMPORTANTE: Asegúrate de activar la vista de detalles
        this.mostrarDetalles.set(true);

        this.cargandoMasivo.set(false);
        this.loteParaEnviar.set(null);
      },
      error: (err) => {
        console.error('Error en la petición:', err);
        this.cargandoMasivo.set(false);
        this.errorConsulta.set("Error de conexión con el servidor.");
      }
    });
  }

  // --- CONSULTA INDIVIDUAL ---

  agregarConsulta(inputElement?: HTMLInputElement) {
    const cuitLimpio = this.cuitBusqueda.replace(/\D/g, '');
    if (cuitLimpio.length !== 11 || !this.validarAlgoritmoCuit(cuitLimpio)) {
      this.errorConsulta.set("CUIT inválido.");
      return;
    }

    this.cargandoManual.set(true);
    // Simulamos la estructura que espera el componente usando el servicio unitario
    this.bcraSvc.getDeudas(cuitLimpio).subscribe({
      next: (res) => {
        const analisis = this.procesarRiesgoCompleto(res.results);
        this.consultasAcumuladas.update(prev => [{
          cuit: cuitLimpio,
          nombre: res.results.denominacion,
          dataDeuda: res,
          dataCheques: res,
          analisis: { ...analisis, esErrorValidacion: false },
          abierto: false
        }, ...prev]);
        this.cuitBusqueda = '';
        this.cargandoManual.set(false);
      },
      error: () => this.cargandoManual.set(false)
    });
  }

  // --- LÓGICA DE NEGOCIO ---

  private procesarRiesgoCompleto(data: any) {
    let tieneChequesSinFondoRecientes = false;
    let cantidadChequesSinFondo = 0;
    let montoTotalChequesSinFondo = 0;
    const tresMesesAtras = new Date();
    tresMesesAtras.setMonth(tresMesesAtras.getMonth() - 3);

    let chequesFiltrados: any[] = [];

    if (data.causales) {
      const sinFondos = data.causales.find((c: any) => c.causal === "SIN FONDOS");
      if (sinFondos) {
        sinFondos.entidades.forEach((ent: any) => {
          const detallesRecientes = ent.detalle.filter((det: any) => {
            const fechaRechazo = new Date(det.fechaRechazo);
            return det.fechaPago === null && fechaRechazo >= tresMesesAtras;
          });
          if (detallesRecientes.length > 0) {
            detallesRecientes.forEach((det: any) => {
              cantidadChequesSinFondo++;
              montoTotalChequesSinFondo += det.monto;
              tieneChequesSinFondoRecientes = true;
            });
            chequesFiltrados.push({ entidad: ent.entidad, detalle: detallesRecientes });
          }
        });
      }
    }

    const entidades = data.periodos?.[0]?.entidades || [];
    const totalDeuda = entidades.reduce((acc: number, e: any) => acc + (e.monto || 0), 0) * 1000;
    const deudaMala = entidades.filter((e: any) => e.situacion > 2).reduce((acc: number, e: any) => acc + (e.monto || 0), 0) * 1000;
    const porcentajeMalo = totalDeuda > 0 ? (deudaMala * 100) / totalDeuda : 0;

    return {
      totalDeuda,
      montoTotalChequesSinFondo,
      cantidadChequesSinFondo,
      maloDeuda: deudaMala,
      tieneChequesSinFondoRecientes,
      motivoRechazo: tieneChequesSinFondoRecientes ? 'Cheques impagos' : (porcentajeMalo > 10 ? 'Situación irregular' : null),
      rechazado: tieneChequesSinFondoRecientes || porcentajeMalo > 10,
      chequesParaMostrar: chequesFiltrados
    };
  }

  // --- HELPERS ---
  private validarAlgoritmoCuit(cuit: string): boolean {
    const coeficientes = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const digitos = cuit.split('').map(Number);
    let suma = 0;
    for (let i = 0; i < 10; i++) suma += digitos[i] * coeficientes[i];
    let resultado = 11 - (suma % 11);
    if (resultado === 11) resultado = 0;
    return resultado === digitos[10];
  }

  toggleAccordion(index: number) {
    this.consultasAcumuladas.update(list => {
      const newList = [...list];
      newList[index].abierto = !newList[index].abierto;
      return newList;
    });
  }

  toggleCheques(index: number, event: Event) {
    event.stopPropagation();
    this.consultasAcumuladas.update(list => {
      const newList = [...list];
      newList[index].chequesAbierto = !newList[index].chequesAbierto;
      return newList;
    });
  }

  limpiarTodo() {
    this.consultasAcumuladas.set([]);
    this.mostrarDetalles.set(false);
    this.loteParaEnviar.set(null);
  }

  toggleMostrar() { this.mostrarDetalles.set(true); }

  getSituacionClass(s: number) {
    const base = "px-3 py-1 rounded-full text-[11px] font-bold ";
    if (s === 1) return base + "bg-green-100 text-green-700";
    if (s === 2) return base + "bg-yellow-100 text-yellow-700";
    return base + "bg-red-100 text-red-700";
  }
}