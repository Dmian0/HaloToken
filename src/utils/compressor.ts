// compressor utility
//
// Comprime los outputs de comandos antes de devolverlos al modelo.
// Estrategias previstas:
//   - Truncar outputs que superen un límite de caracteres
//   - Filtrar líneas repetidas o redundantes
//   - Resumir bloques de texto estructurado (e.g. stack traces, logs)
// El objetivo es reducir el consumo de tokens en más de un 80%.
