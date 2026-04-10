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
  cargando = signal<boolean>(false);
  errorConsulta = signal<string | null>(null);
  mostrarDetalles = signal<boolean>(false);

  // Almacenamiento de datos
  consultasAcumuladas = signal<ConsultaCuit[]>([]);

  // Objeto para envío masivo según tu interfaz CuitProcesado
  loteParaEnviar = signal<CuitProcesado | null>(null);

  // --- SECCIÓN: CARGA MASIVA (EXCEL) - SIN FILTROS ---

  /**
   * Procesa el Excel extrayendo cualquier valor numérico.
   * No filtra por longitud ni por algoritmo; el backend validará todo.
   */
  procesarArchivoExcel(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: any) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      // Matriz de datos crudos
      const matriz: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      const listaTemporal: { id: number; cuit: string }[] = [];
      let indice = 1;
      const cuitsVistos = new Set<string>();

      matriz.forEach((fila) => {
        fila.forEach((celda) => {
          if (celda !== null && celda !== undefined && celda !== '') {
            // Extraemos solo los números
            const valorLimpio = String(celda).replace(/\D/g, '');

            // Si después de limpiar quedó algo de texto numérico, lo agregamos
            if (valorLimpio.length > 0) {
              if (!cuitsVistos.has(valorLimpio)) {
                cuitsVistos.add(valorLimpio);
                listaTemporal.push({
                  id: indice++,
                  cuit: valorLimpio
                });
              }
            }
          }
        });
      });

      // Estructura final: { data: [{id, cuit}] }
      const objetoFinal: CuitProcesado = {
        data: listaTemporal
      };

      this.loteParaEnviar.set(objetoFinal);
      console.log('Objeto generado (Data Cruda total):', objetoFinal);
    };

    reader.readAsArrayBuffer(file);
  }

  /**
   * Envía el objeto completo a la consola (preparado para el endpoint)
   */
  ejecutarConsultaMasiva() {
    const payload = this.loteParaEnviar();

    const payloadJson = JSON.stringify(payload);

    if (!payload || payload.data.length === 0) return;

    this.bcraSvc.getDeudas(payload).subscribe({
      next: (res) => {
        console.log('Respuesta del servidor:', res);
        // Aquí podrías manejar la respuesta exitosa
      },
      error: (err) => {
        console.error('Error en la carga masiva:', err);
        this.errorConsulta.set("Error al enviar los datos al servidor.");
      }
    });

    console.log('--- ENVIANDO DATA CRUDA AL BACKEND ---');
    console.log('JSON Payload:', JSON.stringify(payload));
    console.table(payload.data);



    // Limpiamos la carga masiva tras el envío
    this.loteParaEnviar.set(null);
  }

  // --- SECCIÓN: CONSULTA INDIVIDUAL (Sigue con validación manual) ---

  agregarConsulta(inputElement?: HTMLInputElement) {
    const cuitLimpio = this.cuitBusqueda.replace(/\D/g, '');

    if (!cuitLimpio || cuitLimpio.length !== 11) {
      this.errorConsulta.set("El CUIT debe tener 11 dígitos.");
      inputElement?.focus();
      return;
    }

    if (!this.validarAlgoritmoCuit(cuitLimpio)) {
      this.errorConsulta.set("CUIT inválido (dígito verificador).");
      inputElement?.focus();
      return;
    }

    if (this.consultasAcumuladas().some(c => c.cuit === cuitLimpio)) {
      this.errorConsulta.set(`El CUIT ${cuitLimpio} ya fue consultado.`);
      this.cuitBusqueda = '';
      inputElement?.focus();
      return;
    }

    this.cargando.set(true);
    this.errorConsulta.set(null);

    this.bcraSvc.getDeudas(cuitLimpio).pipe(
      delay(500),
      catchError((err) => {
        const msg = err.error?.error || "Error de conexión.";
        this.errorConsulta.set(msg);
        this.cargando.set(false);
        setTimeout(() => inputElement?.focus(), 0);
        return of(null);
      })
    ).subscribe(res => {
      if (res?.results) {
        const data = res.results;
        const analisis = this.procesarRiesgoCompleto(data);

        this.consultasAcumuladas.update(prev => [{
          cuit: cuitLimpio,
          nombre: data.denominacion,
          dataDeuda: res,
          dataCheques: res,
          analisis: analisis,
          abierto: false,
          chequesAbierto: false
        }, ...prev]);

        this.cuitBusqueda = '';
      } else {
        this.errorConsulta.set("No se encontraron datos.");
      }
      this.cargando.set(false);
      setTimeout(() => inputElement?.focus(), 0);
    });
  }

  // --- MÉTODOS PRIVADOS Y HELPERS ---

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

    const periodoReciente = data.periodos?.[0];
    const entidades = periodoReciente?.entidades || [];
    const totalDeuda = entidades.reduce((acc: number, e: any) => acc + (e.monto || 0), 0) * 1000;
    const deudaMala = entidades.filter((e: any) => e.situacion > 2).reduce((acc: number, e: any) => acc + (e.monto || 0), 0) * 1000;
    const porcentajeMalo = totalDeuda > 0 ? (deudaMala * 100) / totalDeuda : 0;

    let rechazado = tieneChequesSinFondoRecientes || porcentajeMalo > 10;
    let motivo = tieneChequesSinFondoRecientes ? `Cheques impagos (${cantidadChequesSinFondo})` : (porcentajeMalo > 10 ? `Irregular: ${porcentajeMalo.toFixed(1)}%` : null);

    return {
      totalDeuda,
      montoTotalChequesSinFondo,
      cantidadChequesSinFondo,
      maloDeuda: deudaMala,
      tieneChequesSinFondoRecientes,
      motivoRechazo: motivo,
      rechazado,
      chequesParaMostrar: chequesFiltrados
    };
  }

  private validarAlgoritmoCuit(cuit: string): boolean {
    const coeficientes = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const digitos = cuit.split('').map(Number);
    if (digitos.length !== 11) return false;

    let suma = 0;
    for (let i = 0; i < 10; i++) suma += digitos[i] * coeficientes[i];

    let resultado = 11 - (suma % 11);
    if (resultado === 11) resultado = 0;
    if (resultado === 10) return false;

    return resultado === digitos[10];
  }

  toggleAccordion(index: number) {
    this.consultasAcumuladas.update(consultas => {
      const nuevas = [...consultas];
      nuevas.forEach((c, i) => { if (i !== index) c.abierto = false; });
      nuevas[index].abierto = !nuevas[index].abierto;
      return nuevas;
    });
  }

  toggleCheques(index: number, event: Event) {
    event.stopPropagation();
    this.consultasAcumuladas.update(consultas => {
      const nuevas = [...consultas];
      nuevas[index].chequesAbierto = !nuevas[index].chequesAbierto;
      return nuevas;
    });
  }

  eliminarConsulta(cuit: string) {
    this.consultasAcumuladas.update(prev => prev.filter(c => c.cuit !== cuit));
    if (this.consultasAcumuladas().length === 0) this.mostrarDetalles.set(false);
  }

  limpiarTodo() {
    this.consultasAcumuladas.set([]);
    this.mostrarDetalles.set(false);
    this.errorConsulta.set(null);
    this.cuitBusqueda = '';
  }

  toggleMostrar() { this.mostrarDetalles.set(true); }

  getSituacionClass(s: number) {
    const base = "px-3 py-1 rounded-full text-[11px] font-bold ";
    if (s === 1) return base + "bg-green-100 text-green-700";
    if (s === 2) return base + "bg-yellow-100 text-yellow-700";
    return base + "bg-red-100 text-red-700";
  }
}