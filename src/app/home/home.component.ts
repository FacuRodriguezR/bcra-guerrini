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

  agregarConsulta() {
    // 1. "Limpiamos" el valor: eliminamos guiones y cualquier cosa que no sea número
    const cuitLimpio = this.cuitBusqueda.replace(/\D/g, '');

    // 2. Validamos la longitud sobre el CUIT ya limpio
    if (!cuitLimpio || cuitLimpio.length < 11) {
      this.errorConsulta.set("El CUIT debe tener 11 dígitos.");
      return;
    }

    // 3. Verificamos duplicados con el CUIT limpio
    if (this.consultasAcumuladas().some(c => c.cuit === cuitLimpio)) {
      this.errorConsulta.set(`El CUIT ${cuitLimpio} ya está en la lista.`);
      return;
    }

    this.cargando.set(true);
    this.errorConsulta.set(null);

    // 4. Usamos 'cuitLimpio' para las llamadas al servicio
    forkJoin({
      deuda: this.bcraSvc.getDeudas(cuitLimpio).pipe(catchError(() => of(null))),
      cheques: this.bcraSvc.getChequesRechazados(cuitLimpio).pipe(catchError(() => of(null)))
    })
      .pipe(delay(500))
      .subscribe({
        next: (res) => {
          if (res.deuda && res.deuda.results) {
            const analisis = this.procesarRiesgoCompleto(res.deuda, res.cheques);
            const nombrePersona = res.deuda.results.denominacion || 'Nombre no disponible';

            this.consultasAcumuladas.update(prev => [{
              cuit: cuitLimpio, // Guardamos la versión limpia
              nombre: nombrePersona,
              dataDeuda: res.deuda,
              dataCheques: res.cheques,
              analisis: analisis
            },
            //TODO: ESTE ...prev si lo ponemos antes, la ultima consulta queda al final, si lo ponemos aca queda en primer lugar
            ...prev
            ]);

            this.cuitBusqueda = ''; // Limpiamos el input

          } else {
            this.errorConsulta.set(`No se encontraron datos para el CUIT ${cuitLimpio}.`);
          }
          this.cargando.set(false);
        },
      });
  }

  private procesarRiesgoCompleto(deuda: any, cheques: any) {
    // Variables para el análisis de cheques
    let tieneChequesSinFondoRecientes = false;
    let cantidadChequesSinFondo = 0;
    let montoTotalChequesSinFondo = 0;

    const seisMesesAtras = new Date();
    seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 6);

    // 1. Procesamiento de Cheques (Causal: SIN FONDOS)
    if (cheques?.results?.causales) {
      const sinFondos = cheques.results.causales.find((c: any) => c.causal === "SIN FONDOS");

      if (sinFondos) {
        sinFondos.entidades.forEach((ent: any) => {
          // Filtramos los detalles para quedarnos solo con los que no tienen fecha de pago
          const chequesSinPago = ent.detalle.filter((det: any) => det.fechaPago === null);

          chequesSinPago.forEach((det: any) => {
            // 1. Sumamos solo si el cheque sigue impago
            cantidadChequesSinFondo++;
            montoTotalChequesSinFondo += (det.monto || 0);

            // 2. Verificamos si este rechazo impago es reciente (últimos 6 meses)
            const fechaRechazo = new Date(det.fechaRechazo);
            if (fechaRechazo >= seisMesesAtras) {
              tieneChequesSinFondoRecientes = true;
            }
          });
        });
      }
    }

    // 2. Procesamiento de Deuda Bancaria
    // Tomamos el periodo más reciente (índice 0)
    const periodoReciente = deuda.results.periodos[0];
    const entidades = periodoReciente?.entidades || [];

    const totalDeuda = entidades.reduce((acc: number, e: any) => acc + (e.monto || 0), 0) * 1000;
    const deudaMala = entidades
      .filter((e: any) => e.situacion > 2)
      .reduce((acc: number, e: any) => acc + (e.monto || 0), 0) * 1000;

    const porcentajeMalo = totalDeuda > 0 ? (deudaMala * 100) / totalDeuda : 0;

    // 3. Lógica de Decisión (Scoring)
    let rechazado = false;
    let motivo = null;

    if (tieneChequesSinFondoRecientes) {
      rechazado = true;
      motivo = `Cheques sin fondo recientes (${cantidadChequesSinFondo} en total)`;
    } else if (porcentajeMalo > 10) {
      rechazado = true;
      motivo = `Exceso de deuda irregular: ${porcentajeMalo.toFixed(1)}% (Situación > 2)`;
    }

    // 4. Retorno del objeto de análisis
    return {
      totalDeuda: totalDeuda,
      maloDeuda: deudaMala,
      tieneChequesSinFondoRecientes,
      cantidadChequesSinFondo,       // Cantidad total de cheques "SIN FONDOS"
      montoTotalChequesSinFondo,      // Suma total de montos de esos cheques
      motivoRechazo: motivo,
      rechazado: rechazado
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
}