import { User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking'; // <-- 1. Importamos Linking de Expo
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { supabase, Transaction } from '../lib/supabase';

// Interfaz para el Sistema de Ahorros
interface SavingsGoal {
  id: string;
  user_id: string;
  title: string;
  target: number;
  current: number;
}

// Paleta de colores para las porciones del gráfico y las leyendas
const CATEGORY_COLORS = ['#00B37E', '#FF7A00', '#F75A68', '#4EA8DE', '#9B5DE5', '#F15BB5', '#FEE440', '#00F5D4'];

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const isPC = width > 768;

  // --- ESTADOS DE AUTENTICACIÓN ---
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [isSignUp, setIsSignUp] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');

  // --- ESTADOS DE NEGOCIO ---
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [chartType, setChartType] = useState<'expense' | 'income'>('expense');

  // Estados del Formulario de Movimientos (Actualizado para incluir 'savings')
  const [description, setDescription] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [type, setType] = useState<'income' | 'expense' | 'savings'>('income'); 
  const [category, setCategory] = useState<string>('General');

  // --- ESTADOS DE LA SECCIÓN DE AHORROS ---
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [goalTitle, setGoalTitle] = useState<string>('');
  const [goalTarget, setGoalTarget] = useState<string>('');
  const [goalCurrent, setGoalCurrent] = useState<string>('');
  
  // Estado para saber a qué meta asignarle el dinero cuando se crea una transacción tipo 'savings'
  const [selectedGoalId, setSelectedGoalId] = useState<string>('');

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      alert(`${title}: ${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  // --- ESCUCHAR SESIÓN Y DEEP LINKS ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        fetchTransactions();
      } else {
        setIsLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setUser(session.user);
        fetchTransactions();
      } else {
        setUser(null);
        setTransactions([]);
        setSavingsGoals([]);
        setIsLoading(false);
      }
    });

    // 2. FUNCIÓN PARA MANEJAR EL DEEP LINK (PASO 3)
    const handleDeepLink = async (url: string) => {
      if (!url) return;

      // Si el link de redirección viene de Supabase con los tokens de sesión
      if (url.includes('#access_token=') || url.includes('access_token=')) {
        // Formateamos la URL para parsear los hashes (#) como query parameters (?)
        const cleanUrl = url.replace('#', '?');
        const parsed = Linking.parse(cleanUrl);
        
        const accessToken = parsed.queryParams?.access_token as string;
        const refreshToken = parsed.queryParams?.refresh_token as string;

        if (accessToken && refreshToken) {
          setIsLoading(true);
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          
          if (error) {
            showAlert('Error de Verificación', 'No se pudo iniciar sesión con el enlace.');
            setIsLoading(false);
          }
        }
      }
    };

    // Si la app estaba cerrada y el link del mail la abrió de cero
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url);
    });

    // Si la app ya estaba abierta en segundo plano
    const linkingSubscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    return () => {
      subscription.unsubscribe();
      linkingSubscription.remove();
    };
  }, []);

  // --- AUTENTICACIÓN ---
  const handleAuth = async (): Promise<void> => {
    if (!email.trim() || !password.trim()) {
      showAlert('Atención', 'Por favor, completa todos los campos.');
      return;
    }
    try {
      setAuthLoading(true);
      if (isSignUp) {
        // Generamos dinámicamente la URL nativa "foxcash://auth-callback"
        const redirectUrl = Linking.createURL('auth-callback');

        // PASO 2 INYECTADO: Le pasamos la redirección nativa a Supabase
        const { error } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            emailRedirectTo: redirectUrl,
          }
        });
        
        if (error) throw error;
        showAlert('Cuenta creada', 'Te enviamos un correo de confirmación. Tócalo para activar tu cuenta.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error: any) {
      showAlert('Error', error.message || 'Las credenciales ingresadas no son correctas.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async (): Promise<void> => {
    try {
      setIsLoading(true);
      await supabase.auth.signOut();
    } catch (error: any) {
      console.error(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // --- OPERACIONES BASE DE DATOS ---
  const fetchTransactions = async (): Promise<void> => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) {
        // Mapeamos los datos para restaurar el tipo 'savings' localmente si la categoría es 'Ahorro'
        // Esto evita errores de constraints en la base de datos de Supabase
        const mappedData = data.map((tx: any) => ({
          ...tx,
          type: tx.category === 'Ahorro' ? 'savings' : tx.type
        })) as Transaction[];

        setTransactions(mappedData);
      }
    } catch (error: any) {
      console.error(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddTransaction = async (): Promise<void> => {
    if (!description.trim() || !amount || !user) return;
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    // Si es tipo ahorro, sumamos el valor a la meta seleccionada localmente
    if (type === 'savings' && selectedGoalId) {
      setSavingsGoals(prevGoals =>
        prevGoals.map(goal => {
          if (goal.id === selectedGoalId) {
            const nextCurrent = goal.current + parsedAmount;
            return {
              ...goal,
              current: nextCurrent > goal.target ? goal.target : nextCurrent
            };
          }
          return goal;
        })
      );
    }

    const newTx = {
      user_id: user.id,
      description: description.trim(),
      // Tanto el gasto como el ahorro restan saldo disponible
      amount: type === 'income' ? parsedAmount : -parsedAmount,
      // SOLUCIÓN AL ERROR DE CONSTRAINT: Si es 'savings', se envía como 'expense' a Supabase
      type: type === 'savings' ? 'expense' : type,
      category: type === 'savings' ? 'Ahorro' : (category.trim() || 'General'),
    };

    try {
      const { data, error } = await supabase.from('transactions').insert([newTx]).select();
      if (error) throw error;
      if (data) {
        // Inyectamos el tipo original 'savings' localmente para mantener los estilos celestes intactos
        const localTx = {
          ...data[0],
          type: type 
        } as Transaction;

        setTransactions([localTx, ...transactions]);
        setDescription('');
        setAmount('');
        setCategory('General');
        if (type === 'savings') setType('income');
      }
    } catch (error: any) {
      console.error(error.message);
    }
  };

  const handleDeleteTransaction = async (id: number): Promise<void> => {
    try {
      // Si la transacción eliminada era un ahorro, devolvemos la plata a la meta si coincide
      const txToDelete = transactions.find(t => t.id === id);
      if (txToDelete && txToDelete.type === 'savings') {
        if (savingsGoals.length > 0) {
          setSavingsGoals(prev => {
            const copy = [...prev];
            copy[0].current = Math.max(0, copy[0].current - Math.abs(txToDelete.amount));
            return copy;
          });
        }
      }

      const { error } = await supabase.from('transactions').delete().eq('id', id);
      if (error) throw error;
      setTransactions(transactions.filter((tx) => tx.id !== id));
    } catch (error: any) {
      console.error(error.message);
    }
  };

  // --- OPERACIONES DEL SISTEMA DE AHORROS ---
  const handleAddSavingsGoal = () => {
    if (!goalTitle.trim() || !goalTarget || !user) return;
    const parsedTarget = parseFloat(goalTarget);
    const parsedCurrent = parseFloat(goalCurrent) || 0;

    if (isNaN(parsedTarget) || parsedTarget <= 0 || isNaN(parsedCurrent) || parsedCurrent < 0) return;

    const newGoal: SavingsGoal = {
      id: Date.now().toString(),
      user_id: user.id,
      title: goalTitle.trim(),
      target: parsedTarget,
      current: parsedCurrent > parsedTarget ? parsedTarget : parsedCurrent,
    };

    const updatedGoals = [...savingsGoals, newGoal];
    setSavingsGoals(updatedGoals);
    
    if (!selectedGoalId) {
      setSelectedGoalId(newGoal.id);
    }

    setGoalTitle('');
    setGoalTarget('');
    setGoalCurrent('');
  };

  const handleDeleteSavingsGoal = (id: string) => {
    setSavingsGoals(savingsGoals.filter((goal) => goal.id !== id));
    if (selectedGoalId === id) setSelectedGoalId('');
  };

  // --- PROCESAMIENTO DE DATOS ---
  const { totalIncome, totalExpense, balance, chartData } = useMemo(() => {
    let income = 0;
    let expense = 0;
    const categoryTotals: { [key: string]: number } = {};

    transactions.forEach((tx) => {
      const numericAmount = Math.abs(Number(tx.amount));
      if (tx.type === 'income') income += numericAmount;
      if (tx.type === 'expense' || tx.type === 'savings') expense += numericAmount;

      if (tx.type === chartType || (chartType === 'expense' && tx.type === 'savings')) {
        const cat = tx.type === 'savings' ? 'Ahorro' : (tx.category.trim() || 'General');
        categoryTotals[cat] = (categoryTotals[cat] || 0) + numericAmount;
      }
    });

    const targetTotal = chartType === 'income' ? income : expense;
    
    const chartDataArray = Object.keys(categoryTotals).map((cat, index) => {
      const value = categoryTotals[cat];
      const percentage = targetTotal > 0 ? (value / targetTotal) * 100 : 0;
      return {
        category: cat,
        value,
        percentage,
        color: cat === 'Ahorro' ? '#4EA8DE' : CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      };
    }).sort((a, b) => b.value - a.value);

    return {
      totalIncome: income,
      totalExpense: expense,
      balance: income - expense,
      chartData: chartDataArray,
    };
  }, [transactions, chartType]);

  const toggleChartType = () => {
    setChartType(chartType === 'expense' ? 'income' : 'expense');
  };

  const renderTransactionItem = ({ item }: { item: Transaction }) => (
    <View style={styles.txCard}>
      <View style={styles.txInfo}>
        <Text style={styles.txDescription}>{item.description}</Text>
        <Text style={styles.txCategory}>{item.category}</Text>
      </View>
      <View style={styles.txAmountContainer}>
        <Text style={[
          styles.txAmount, 
          item.type === 'income' ? styles.incomeText : (item.type === 'savings' ? styles.savingsText : styles.expenseText)
        ]}>
          {item.type === 'income' ? '+' : '-'} ${Math.abs(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </Text>
        <TouchableOpacity onPress={() => handleDeleteTransaction(item.id)} style={styles.deleteBtn}>
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (isLoading && user) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#FF7A00" />
        <Text style={{ color: '#8D8D99', marginTop: 12, fontWeight: '500' }}>Actualizando panel...</Text>
      </View>
    );
  }

  // PANTALLA 1: LOGIN / REGISTRO NATIVO CON EMAIL
  if (!user) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <StatusBar barStyle="light-content" backgroundColor="#0F1014" />
        <View style={styles.loginCard}>
          <Text style={styles.loginLogo}>Fox<Text style={{ color: '#FF7A00' }}>cash</Text></Text>
          <Text style={styles.loginSubtitle}>
            {isSignUp ? 'Crea una cuenta para comenzar.' : 'Ingresa tus credenciales de acceso.'}
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Correo electrónico"
            placeholderTextColor="#7C7C8A"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor="#7C7C8A"
            secureTextEntry
            autoCapitalize="none"
            value={password}
            onChangeText={setPassword}
          />
          <TouchableOpacity style={styles.submitBtn} onPress={handleAuth} disabled={authLoading}>
            {authLoading ? <ActivityIndicator color="#0F1014" /> : <Text style={styles.submitBtnText}>{isSignUp ? 'Registrarse' : 'Iniciar sesión'}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.switchAuthBtn} onPress={() => setIsSignUp(!isSignUp)}>
            <Text style={styles.switchAuthText}>{isSignUp ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // PANTALLA 2: DASHBOARD PRINCIPAL CORREGIDO
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F1014" />

      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>Fox<Text style={{ color: '#FF7A00' }}>cash</Text></Text>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutBtnText}>Cerrar sesión</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.headerSubtitle}>{user.email}</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContainer, isPC && styles.pcLayout]}>
        
        {/* PANEL IZQUIERDO: GRÁFICOS, RESUMEN, FORMULARIOS Y AHORROS */}
        <View style={[styles.panel, isPC && styles.leftPanel]}>
          
          {/* CONTROLADOR DE GRÁFICOS */}
          <View style={styles.chartSectionContainer}>
            <View style={styles.chartHeaderSelector}>
              <TouchableOpacity onPress={toggleChartType} style={styles.arrowBtn}>
                <Text style={styles.arrowText}>◀</Text>
              </TouchableOpacity>
              <Text style={styles.chartSectionTitle}>
                Distribución de {chartType === 'expense' ? 'gastos/ahorros' : 'ingresos'}
              </Text>
              <TouchableOpacity onPress={toggleChartType} style={styles.arrowBtn}>
                <Text style={styles.arrowText}>▶</Text>
              </TouchableOpacity>
            </View>

            {chartData.length === 0 ? (
              <View style={styles.emptyChartBox}>
                <Text style={styles.emptyText}>No hay registros para este período.</Text>
              </View>
            ) : (
              <View style={[styles.chartBody, !isPC && styles.chartBodyMobile]}>
                
                {/* ANILLO CIRCULAR */}
                <View style={styles.pieContainer}>
                  <View style={styles.pieOuterRing}>
                    {(() => {
                      let accumulatedRotation = 0;
                      return chartData.map((slice, i) => {
                        const degrees = (slice.percentage / 100) * 360;
                        const currentRotation = accumulatedRotation;
                        accumulatedRotation += degrees;

                        return (
                          <View
                            key={i}
                            style={[
                              styles.pieSegment,
                              {
                                borderColor: slice.color,
                                transform: [{ rotate: `${currentRotation}deg` }],
                                borderTopColor: slice.color,
                                borderRightColor: degrees > 90 ? slice.color : 'transparent',
                                borderBottomColor: degrees > 180 ? slice.color : 'transparent',
                                borderLeftColor: degrees > 270 ? slice.color : 'transparent',
                              }
                            ]}
                          />
                        );
                      });
                    })()}
                    
                    <View style={styles.pieCenterCircle}>
                      <Text style={styles.pieCenterPercentage}>
                        {chartData[0]?.percentage.toFixed(0)}%
                      </Text>
                      <Text style={styles.pieCenterLabel} numberOfLines={1}>
                        {chartData[0]?.category}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* REFERENCIAS */}
                <View style={styles.legendContainer}>
                  {chartData.slice(0, 5).map((item, index) => (
                    <View key={index} style={styles.legendRow}>
                      <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                      <Text style={styles.legendText} numberOfLines={1}>
                        {item.category}: <Text style={styles.legendHighlight}>${item.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({item.percentage.toFixed(0)}%)</Text>
                      </Text>
                    </View>
                  ))}
                </View>

              </View>
            )}
          </View>

          {/* BALANCE GENERAL */}
          <View style={styles.balanceCard}>
            <Text style={styles.cardLabel}>SALDO DISPONIBLE</Text>
            <Text style={[styles.balanceNumber, balance >= 0 ? styles.incomeText : styles.expenseText]}>
              ${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </Text>
          </View>

          {/* TARJETAS RESUMEN */}
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, styles.borderIncome]}>
              <Text style={styles.summaryLabel}>Ingresos</Text>
              <Text style={[styles.summaryNumber, styles.incomeText]}>
                +${totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={[styles.summaryCard, styles.borderExpense]}>
              <Text style={styles.summaryLabel}>Gastos y Ahorros</Text>
              <Text style={[styles.summaryNumber, styles.expenseText]}>
                -${totalExpense.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </Text>
            </View>
          </View>

          {/* FORMULARIO DE TRANSACCIONES */}
          <View style={styles.formContainer}>
            <Text style={styles.sectionTitle}>Nueva transacción</Text>
            <View style={styles.typeSelector}>
              <TouchableOpacity style={[styles.typeBtn, type === 'income' && styles.typeBtnIncomeActive]} onPress={() => setType('income')}>
                <Text style={[styles.typeBtnText, type === 'income' && styles.typeBtnTextActive]}>Ingreso</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.typeBtn, type === 'savings' && styles.typeBtnSavingsActive]} onPress={() => setType('savings')}>
                <Text style={[styles.typeBtnText, type === 'savings' && styles.typeBtnTextActive]}>Ahorro</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.typeBtn, type === 'expense' && styles.typeBtnExpenseActive]} onPress={() => setType('expense')}>
                <Text style={[styles.typeBtnText, type === 'expense' && styles.typeBtnTextActive]}>Gasto</Text>
              </TouchableOpacity>
            </View>
            <TextInput style={styles.input} placeholder="Descripción" placeholderTextColor="#7C7C8A" value={description} onChangeText={setDescription} />
            <TextInput style={styles.input} placeholder="Monto ($)" placeholderTextColor="#7C7C8A" keyboardType="numeric" value={amount} onChangeText={setAmount} />
            
            {type === 'savings' ? (
              <View style={styles.goalPickerContainer}>
                <Text style={styles.goalPickerLabel}>Asignar a la meta:</Text>
                {savingsGoals.length === 0 ? (
                  <Text style={{ color: '#F75A68', fontSize: 13, marginBottom: 12, fontWeight: '500' }}>⚠️ Debes crear una meta abajo primero.</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                    {savingsGoals.map(goal => (
                      <TouchableOpacity 
                        key={goal.id} 
                        style={[styles.goalChip, selectedGoalId === goal.id && styles.goalChipActive]}
                        onPress={() => setSelectedGoalId(goal.id)}
                      >
                        <Text style={[styles.goalChipText, selectedGoalId === goal.id && styles.goalChipTextActive]}>{goal.title}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            ) : (
              <TextInput style={styles.input} placeholder="Categoría (Ej: Comida, Servicios)" placeholderTextColor="#7C7C8A" value={category} onChangeText={setCategory} />
            )}

            <TouchableOpacity style={styles.submitBtn} onPress={handleAddTransaction}>
              <Text style={styles.submitBtnText}>Agregar registro</Text>
            </TouchableOpacity>
          </View>

          {/* SECCIÓN: METAS DE AHORRO */}
          <View style={styles.formContainer}>
            <Text style={styles.sectionTitle}>Metas de ahorro</Text>
            
            {savingsGoals.length === 0 ? (
              <Text style={[styles.emptyText, { marginTop: 5, marginBottom: 15 }]}>No has fijado objetivos de ahorro todavía.</Text>
            ) : (
              savingsGoals.map((item) => {
                const progressPercentage = item.target > 0 ? (item.current / item.target) * 100 : 0;
                return (
                  <View key={item.id} style={styles.savingsCard}>
                    <View style={styles.savingsHeaderRow}>
                      <Text style={styles.savingsGoalTitle}>{item.title}</Text>
                      <TouchableOpacity onPress={() => handleDeleteSavingsGoal(item.id)} style={styles.deleteBtn}>
                        <Text style={styles.deleteBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    
                    <View style={styles.savingsProgressWrapper}>
                      <View style={styles.savingsProgressBarOuter}>
                        <View style={[styles.savingsProgressBarInner, { width: `${progressPercentage}%` }]} />
                      </View>
                      <Text style={styles.savingsProgressPercentText}>{progressPercentage.toFixed(0)}%</Text>
                    </View>

                    <Text style={styles.savingsAmountLabel}>
                      Guardado: <Text style={styles.savingsText}>${item.current.toLocaleString()}</Text> de <Text style={{ color: '#E1E1E6' }}>${item.target.toLocaleString()}</Text>
                    </Text>
                  </View>
                );
              })
            )}

            <Text style={[styles.sectionTitle, { fontSize: 14, marginTop: 10, color: '#8D8D99' }]}>Crear nuevo objetivo</Text>
            <TextInput style={styles.input} placeholder="¿Para qué estás ahorrando? (Ej: Monitor 4K)" placeholderTextColor="#7C7C8A" value={goalTitle} onChangeText={setGoalTitle} />
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <View style={{ flex: 1 }}>
                <TextInput style={styles.input} placeholder="Monto Objetivo ($)" placeholderTextColor="#7C7C8A" keyboardType="numeric" value={goalTarget} onChangeText={setGoalTarget} />
              </View>
              <View style={{ flex: 1 }}>
                <TextInput style={styles.input} placeholder="Monto Inicial ($)" placeholderTextColor="#7C7C8A" keyboardType="numeric" value={goalCurrent} onChangeText={setGoalCurrent} />
              </View>
            </View>
            <TouchableOpacity style={[styles.submitBtn, { backgroundColor: '#00B37E' }]} onPress={handleAddSavingsGoal}>
              <Text style={styles.submitBtnText}>Fijar Meta de Ahorro</Text>
            </TouchableOpacity>
          </View>

        </View>

        {/* PANEL DERECHO: HISTORIAL TRANSACCIONAL */}
        <View style={[styles.panel, isPC && styles.rightPanel]}>
          <Text style={styles.sectionTitle}>Historial de movimientos</Text>
          <FlatList
            data={transactions}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderTransactionItem}
            scrollEnabled={!isPC}
            ListEmptyComponent={<Text style={styles.emptyText}>No se encontraron transacciones guardadas.</Text>}
          />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F1014' },
  center: { justifyContent: 'center', alignItems: 'center' },
  loginCard: { width: '85%', maxWidth: 400, backgroundColor: '#16171D', padding: 32, borderRadius: 16, borderWidth: 1, borderColor: '#202227' },
  loginLogo: { fontSize: 42, fontWeight: '900', color: '#E1E1E6', marginBottom: 12, letterSpacing: 2, textAlign: 'center' },
  loginSubtitle: { fontSize: 14, color: '#8D8D99', textAlign: 'center', marginBottom: 25, lineHeight: 22 },
  switchAuthBtn: { marginTop: 20, alignItems: 'center' },
  switchAuthText: { color: '#FF7A00', fontSize: 14, fontWeight: '600' },
  header: { padding: 20, borderBottomWidth: 1, borderColor: '#1E1F24' },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 28, fontWeight: '900', color: '#E1E1E6' },
  headerSubtitle: { fontSize: 14, color: '#8D8D99', marginTop: 4 },
  logoutBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#202227' },
  logoutBtnText: { color: '#F75A68', fontSize: 13, fontWeight: '600' },
  scrollContainer: { padding: 20 },
  pcLayout: { flexDirection: 'row', alignItems: 'flex-start', gap: 25, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  panel: { width: '100%' },
  leftPanel: { flex: 1.2 },
  rightPanel: { flex: 1, backgroundColor: '#16171D', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#202227' },
  chartSectionContainer: { backgroundColor: '#16171D', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#202227', marginBottom: 15 },
  chartHeaderSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  arrowBtn: { backgroundColor: '#202227', width: 36, height: 36, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#2E3038' },
  arrowText: { color: '#FF7A00', fontSize: 14, fontWeight: 'bold' },
  chartSectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#E1E1E6', textTransform: 'capitalize' },
  chartBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', gap: 20 },
  chartBodyMobile: { flexDirection: 'column', alignItems: 'center' },
  emptyChartBox: { height: 120, justifyContent: 'center', alignItems: 'center' },
  pieContainer: { width: 130, height: 130, justifyContent: 'center', alignItems: 'center' },
  pieOuterRing: { width: 120, height: 120, borderRadius: 60, justifyContent: 'center', alignItems: 'center', backgroundColor: '#202227', overflow: 'hidden' },
  pieSegment: { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 12, backgroundColor: 'transparent' },
  pieCenterCircle: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#16171D', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  pieCenterPercentage: { fontSize: 20, fontWeight: 'bold', color: '#E1E1E6' },
  pieCenterLabel: { fontSize: 11, color: '#8D8D99', textTransform: 'lowercase', marginTop: 2, fontWeight: '600', paddingHorizontal: 4 },
  legendContainer: { flex: 1, justifyContent: 'center', width: '100%' },
  legendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  legendText: { color: '#C4C4CC', fontSize: 13, flex: 1 },
  legendHighlight: { fontWeight: '700', color: '#E1E1E6' },
  balanceCard: { backgroundColor: '#16171D', padding: 24, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: '#202227', marginBottom: 15 },
  cardLabel: { fontSize: 12, color: '#8D8D99', fontWeight: '700', letterSpacing: 1.5 },
  balanceNumber: { fontSize: 36, fontWeight: 'bold', marginTop: 8 },
  summaryRow: { flexDirection: 'row', gap: 15, marginBottom: 25 },
  summaryCard: { flex: 1, backgroundColor: '#16171D', padding: 16, borderRadius: 12, borderLeftWidth: 4 },
  borderIncome: { borderColor: '#00B37E' },
  borderExpense: { borderColor: '#F75A68' },
  summaryLabel: { fontSize: 12, color: '#8D8D99', fontWeight: '600' },
  summaryNumber: { fontSize: 16, fontWeight: 'bold', marginTop: 4 },
  formContainer: { backgroundColor: '#16171D', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#202227', marginBottom: 25 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#E1E1E6', marginBottom: 15 },
  typeSelector: { flexDirection: 'row', gap: 10, marginBottom: 15 },
  typeBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#202227', alignItems: 'center' },
  
  typeBtnIncomeActive: { backgroundColor: 'rgba(0, 179, 126, 0.15)', borderWidth: 1, borderColor: '#00B37E' },
  typeBtnSavingsActive: { backgroundColor: 'rgba(78, 168, 222, 0.15)', borderWidth: 1, borderColor: '#4EA8DE' },
  typeBtnExpenseActive: { backgroundColor: 'rgba(247, 90, 104, 0.15)', borderWidth: 1, borderColor: '#F75A68' },
  typeBtnText: { color: '#8D8D99', fontWeight: '600', fontSize: 13 },
  typeBtnTextActive: { color: '#E1E1E6' },
  
  input: { backgroundColor: '#202227', borderRadius: 8, padding: 14, color: '#E1E1E6', fontSize: 15, marginBottom: 12, width: '100%' },
  submitBtn: { backgroundColor: '#FF7A00', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8, width: '100%', justifyContent: 'center' },
  submitBtnText: { color: '#0F1014', fontSize: 16, fontWeight: 'bold' },
  txCard: { backgroundColor: '#202227', padding: 14, borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  txInfo: { flex: 1, paddingRight: 10 },
  txDescription: { color: '#E1E1E6', fontSize: 15, fontWeight: '600' },
  txCategory: { color: '#8D8D99', fontSize: 12, marginTop: 2 },
  txAmountContainer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  txAmount: { fontSize: 15, fontWeight: 'bold' },
  incomeText: { color: '#00B37E' },
  savingsText: { color: '#4EA8DE' },
  expenseText: { color: '#F75A68' },
  deleteBtn: { padding: 4 },
  deleteBtnText: { color: '#7C7C8A', fontSize: 14 },
  emptyText: { color: '#7C7C8A', textAlign: 'center', marginTop: 30 },

  savingsCard: { backgroundColor: '#202227', padding: 16, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: '#2E3038' },
  savingsHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  savingsGoalTitle: { color: '#E1E1E6', fontSize: 15, fontWeight: '700' },
  savingsProgressWrapper: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  savingsProgressBarOuter: { flex: 1, height: 8, backgroundColor: '#16171D', borderRadius: 4, overflow: 'hidden' },
  savingsProgressBarInner: { height: '100%', backgroundColor: '#4EA8DE', borderRadius: 4 },
  savingsProgressPercentText: { color: '#4EA8DE', fontSize: 12, fontWeight: 'bold', width: 32, textAlign: 'right' },
  savingsAmountLabel: { color: '#8D8D99', fontSize: 12, fontWeight: '500' },
  
  goalPickerContainer: { marginBottom: 12 },
  goalPickerLabel: { color: '#8D8D99', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  goalChip: { backgroundColor: '#202227', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#2E3038' },
  goalChipActive: { backgroundColor: 'rgba(78, 168, 222, 0.15)', borderColor: '#4EA8DE' },
  goalChipText: { color: '#8D8D99', fontSize: 13, fontWeight: '600' },
  goalChipTextActive: { color: '#4EA8DE' }
});