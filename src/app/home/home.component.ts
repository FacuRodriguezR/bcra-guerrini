import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BcraService } from '../bcra.service';
import { catchError, delay, forkJoin, of } from 'rxjs';
import { HeaderComponent } from '../components/header/header.component';

interface ConsultaCuit {
  cuit: string;
  nombre: string;
  dataDeuda: any;
  dataCheques: any;
  abierto?: boolean
  chequesAbierto?: boolean,
  analisis: {
    totalDeuda: number;
    maloDeuda: number;
    tieneChequesSinFondoRecientes: boolean;
    motivoRechazo: string | null;
    rechazado: boolean;
    cantidadChequesSinFondo: number;
    montoTotalChequesSinFondo: number;
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

  cuitBusqueda = '';
  cargando = signal<boolean>(false);
  errorConsulta = signal<string | null>(null);
  consultasAcumuladas = signal<ConsultaCuit[]>([]);
  mostrarDetalles = signal<boolean>(false);

  // En home.component.ts
  toggleAccordion(index: number) {
    this.consultasAcumuladas.update(consultas => {
      const nuevas = [...consultas];
      // Cerramos los demás para que sea un accordion verdadero (opcional)
      nuevas.forEach((c, i) => { if (i !== index) c.abierto = false; });
      nuevas[index].abierto = !nuevas[index].abierto;
      return nuevas;
    });
  }

  toggleCheques(index: number, event: Event) {
    event.stopPropagation(); // Evitamos que el click dispare el acordeón principal
    this.consultasAcumuladas.update(consultas => {
      const nuevas = [...consultas];
      nuevas[index].chequesAbierto = !nuevas[index].chequesAbierto;
      return nuevas;
    });
  }

  obtenerConsulta() {
    const cuitLimpio = this.cuitBusqueda.replace(/\D/g, '');
    if (cuitLimpio) {

      this.bcraSvc.getDeudas(cuitLimpio).subscribe(
        data => {
          console.log('dataLucas', data)
        }
      )
    }
  }


  agregarConsulta(inputElement?: HTMLInputElement) {
    const cuitLimpio = this.cuitBusqueda.replace(/\D/g, '');

    // 1. Validaciones iniciales
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
      this.cuitBusqueda = ''; // Limpiamos para el siguiente
      inputElement?.focus();
      return;
    }

    // 2. Estado de carga
    this.cargando.set(true);
    this.errorConsulta.set(null);

    // 3. Petición al servicio
    this.bcraSvc.getDeudas(cuitLimpio).pipe(
      delay(500),
      catchError((err) => {
        const msg = err.error?.error || "Error de conexión con el servidor.";
        this.errorConsulta.set(msg);
        this.cargando.set(false);

        // Devolvemos el foco incluso si falla la red
        setTimeout(() => inputElement?.focus(), 0);
        return of(null);
      })
    ).subscribe(res => {
      if (!res) return;

      if (res && res.results) {
        const data = res.results;
        const analisis = this.procesarRiesgoCompleto(data);

        // Actualizamos la lista
        this.consultasAcumuladas.update(prev => [{
          cuit: cuitLimpio,
          nombre: data.denominacion,
          dataDeuda: res,
          dataCheques: res,
          analisis: analisis,
          abierto: false,
          chequesAbierto: false
        }, ...prev]);

        // Limpiamos el campo para el siguiente CUIT
        this.cuitBusqueda = '';
        this.errorConsulta.set(null);
      } else {
        this.errorConsulta.set("No se encontraron datos para este CUIT.");
      }

      // 4. Finalización y recuperación del foco
      this.cargando.set(false);

      // Usamos setTimeout para esperar a que Angular habilite el input (por el [disabled])
      // antes de intentar poner el cursor adentro.
      setTimeout(() => {
        inputElement?.focus();
      }, 0);
    });
  }

  private procesarRiesgoCompleto(data: any) {
    let tieneChequesSinFondoRecientes = false;
    let cantidadChequesSinFondo = 0;
    let montoTotalChequesSinFondo = 0;

    // 1. Configurar filtro de tiempo (3 meses atrás desde hoy)
    const tresMesesAtras = new Date();
    tresMesesAtras.setMonth(tresMesesAtras.getMonth() - 3);

    // Array para guardar solo lo que queremos mostrar en el HTML
    let chequesFiltrados: any[] = [];

    // 2. Procesar Cheques (Causales)
    if (data.causales) {
      const sinFondos = data.causales.find((c: any) => c.causal === "SIN FONDOS");

      if (sinFondos) {
        sinFondos.entidades.forEach((ent: any) => {
          // Filtrar detalles: Sin fecha de pago Y dentro del rango de 3 meses
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

            // Guardamos la entidad con sus detalles filtrados para el acordeón
            chequesFiltrados.push({
              entidad: ent.entidad,
              detalle: detallesRecientes
            });
          }
        });
      }
    }

    // 3. Procesar Deuda Bancaria (Situación en el sistema financiero)
    const periodoReciente = data.periodos?.[0];
    const entidades = periodoReciente?.entidades || [];

    // Calculamos montos (ajustar el * 1000 según cómo lleguen los datos de tu API)
    const totalDeuda = entidades.reduce((acc: number, e: any) => acc + (e.monto || 0), 0) * 1000;
    const deudaMala = entidades
      .filter((e: any) => e.situacion > 2)
      .reduce((acc: number, e: any) => acc + (e.monto || 0), 0) * 1000;

    const porcentajeMalo = totalDeuda > 0 ? (deudaMala * 100) / totalDeuda : 0;

    // 4. Lógica de Decisión (Viable / Rechazado)
    let rechazado = false;
    let motivo = null;

    if (tieneChequesSinFondoRecientes) {
      rechazado = true;
      motivo = `Cheques impagos recientes (${cantidadChequesSinFondo})`;
    } else if (porcentajeMalo > 10) {
      rechazado = true;
      motivo = `Situación irregular: ${porcentajeMalo.toFixed(1)}%`;
    }

    // 5. Retornar objeto de análisis completo
    return {
      totalDeuda,
      montoTotalChequesSinFondo,
      cantidadChequesSinFondo,
      maloDeuda: deudaMala,
      tieneChequesSinFondoRecientes,
      motivoRechazo: motivo,
      rechazado,
      chequesParaMostrar: chequesFiltrados // <--- Esta es la clave para el HTML
    };
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

  formatPeriodo(p: string) {
    return p ? `${p.substring(4)}/${p.substring(2, 4)}` : 'N/A';
  }

  getSituacionClass(s: number) {
    const base = "px-3 py-1 rounded-full text-[11px] font-bold ";
    if (s === 1) return base + "bg-green-100 text-green-700";
    if (s === 2) return base + "bg-yellow-100 text-yellow-700";
    return base + "bg-red-100 text-red-700";
  }



  private validarAlgoritmoCuit(cuit: string): boolean {
    const coeficientes = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const digitos = cuit.split('').map(Number);
    const verificadorOriginal = digitos[10];

    // Calculamos el producto escalar
    let suma = 0;
    for (let i = 0; i < 10; i++) {
      suma += digitos[i] * coeficientes[i];
    }

    let resultado = 11 - (suma % 11);

    // Casos especiales de AFIP/ANSES
    if (resultado === 11) {
      resultado = 0;
    } else if (resultado === 10) {
      // Si da 10, el CUIT es inválido (usualmente AFIP cambia el prefijo 20 a 23 en estos casos)
      return false;
    }

    return resultado === verificadorOriginal;
  }
}