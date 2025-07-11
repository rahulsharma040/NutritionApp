import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  Button,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  Image,
  StyleSheet,
  SafeAreaView
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useAuthRequest, makeRedirectUri, ResponseType } from 'expo-auth-session';
import { useNavigation } from '@react-navigation/native';
import { auth, db } from '../firebaseConfig';
import { doc, setDoc } from 'firebase/firestore';
import Navbar from '../components/navbar'; // Import the Navbar component

// 🔐 Slack credentials from environment
const slackTeamId = process.env.SLACK_TEAM_ID!;
const slackClientId = process.env.SLACK_CLIENT_ID!;
const slackClientSecret = process.env.SLACK_CLIENT_SECRET!;
const coachEmail = process.env.COACH_EMAIL!;
const publicChannelId = process.env.PUBLIC_CHANNEL_ID!;

// 🔗 Use Expo's auth proxy for redirect URI
const redirectUri = 'https://auth.expo.io/@parthratra11/NutritionApp';
// const redirectUri = makeRedirectUri({ useProxy: true });
console.log('Using redirectUri:', redirectUri);

// 🔗 Slack Auth Discovery
const discovery = {
  authorizationEndpoint: 'https://slack.com/oauth/v2/authorize',
  tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
};

// Optional domain for display
const slackWorkspaceDomain = 'nutritionappglobal.slack.com';

export default function SlackScreen() {
  const navigation = useNavigation();
  const [slackToken, setSlackToken] = useState<string | null>(null);
  const [dmChannel, setDmChannel] = useState<string>('');
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Add navbar state
  const scrollY = useRef(new Animated.Value(0)).current;
  const navOpacity = useRef(new Animated.Value(1)).current;
  const lastScrollY = useRef(0);
  const scrollTimeout = useRef(null);

  // Add navbar ref
  const navbarRef = useRef(null);

  // 🔑 Set up Slack OAuth request
  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: slackClientId,
      scopes: [
        'chat:write',
        'channels:read',
        'channels:history',
        'groups:read',
        'groups:history',
        'im:read',
        'im:history',
        'im:write',
        'users:read',
        'users:read.email',
        'team:read',
        'users.profile:read',
      ],
      redirectUri,
      responseType: ResponseType.Code,
      extraParams: { team: slackTeamId },
    },
    discovery
  );

  // 🔁 Restore stored token
  useEffect(() => {
    (async () => {
      const token = await SecureStore.getItemAsync('slackToken');
      if (token) {
        setSlackToken(token);
        initSlack(token);
      }
    })();
  }, []);

  // 🎯 Slack OAuth response handler
  useEffect(() => {
    console.log('OAuth Response:', response);
    if (response?.type === 'success' && response.params.code) {
      exchangeSlackToken(response.params.code);
    }
  }, [response]);

  const handleSlackLogin = async () => {
    console.log('Prompting Slack login with redirectUri:', redirectUri);
    await promptAsync({ useProxy: true }); // <-- must be true for Expo proxy URI
  };

  const exchangeSlackToken = async (code: string) => {
    console.log('Exchanging token with redirectUri:', redirectUri);
    try {
      const res = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `client_id=${slackClientId}&client_secret=${slackClientSecret}&code=${code}&redirect_uri=${encodeURIComponent(
          redirectUri
        )}`,
      });

      const tokenData = await res.json();
      console.log('Token Exchange Data:', tokenData);

      if (!tokenData.ok) {
        Alert.alert('Slack Auth Error', tokenData.error || 'Token exchange failed');
        return;
      }

      const token = tokenData.access_token;
      setSlackToken(token);
      await SecureStore.setItemAsync('slackToken', token);

      if (auth.currentUser) {
        await setDoc(
          doc(db, 'users', auth.currentUser.uid),
          {
            slackToken: token,
            slackUserId: tokenData.authed_user?.id,
            slackTeam: tokenData.team?.id,
          },
          { merge: true }
        );
      }

      initSlack(token);
    } catch (e: any) {
      Alert.alert('Slack Login Error', e.message || 'OAuth flow failed');
    }
  };

  const initSlack = async (token: string) => {
    setLoading(true);
    try {
      // 1. Get coach ID by email
      const coachRes = await fetch(
        `https://slack.com/api/users.lookupByEmail?email=${coachEmail}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const coachData = await coachRes.json();
      const coachId = coachData.user?.id;
      if (!coachId) throw new Error('Coach not found');

      // 2. Open a DM with the coach
      const dmRes = await fetch('https://slack.com/api/conversations.open', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ users: coachId }),
      });
      const dmData = await dmRes.json();
      if (!dmData.ok) throw new Error('Could not open DM');
      const dmId = dmData.channel.id;
      setDmChannel(dmId);

      // 3. Fetch DM + public channel messages
      const [dmMsgs, publicMsgs] = await Promise.all([
        fetchHistory(dmId, token),
        fetchHistory(publicChannelId, token),
      ]);
      setMessages([...dmMsgs, ...publicMsgs]);
    } catch (e: any) {
      Alert.alert('Slack Init Error', e.message || 'Slack setup failed');
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async (channel: string, token: string) => {
    const res = await fetch(`https://slack.com/api/conversations.history?channel=${channel}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.ok ? data.messages : [];
  };

  const send = async () => {
    if (!input.trim() || !slackToken) return;

    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${slackToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: dmChannel || publicChannelId,
        text: input,
      }),
    });

    setInput('');
    initSlack(slackToken); // refresh messages
  };

  // Update the handleScroll function to use the navbar ref
  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: false,
      listener: (event) => {
        const currentScrollY = event.nativeEvent.contentOffset.y;
        
        if (scrollTimeout.current) {
          clearTimeout(scrollTimeout.current);
        }

        // Show navbar when scrolling starts
        if (navbarRef.current) {
          navbarRef.current.show();
        }

        // Hide navbar after scrolling stops
        scrollTimeout.current = setTimeout(() => {
          if (navbarRef.current) {
            navbarRef.current.hide();
          }
        }, 2000);

        lastScrollY.current = currentScrollY;
      },
    }
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {!slackToken ? (
          <View style={styles.loginContainer}>
            <Text style={styles.workspaceText}>
              Workspace: {slackWorkspaceDomain}
            </Text>
            <Button title="Login with Slack" onPress={handleSlackLogin} disabled={!request} />
          </View>
        ) : (
          <>
            {loading && <ActivityIndicator style={styles.loader} />}
            <FlatList
              data={messages}
              keyExtractor={(_, i) => String(i)}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              renderItem={({ item }) => (
                <View style={styles.messageItem}>
                  <Text style={styles.messageUser}>{item.username || item.user}</Text>
                  <Text style={styles.messageText}>{item.text}</Text>
                </View>
              )}
              contentContainerStyle={styles.messagesList}
            />
            <View style={styles.inputContainer}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Type a message"
                style={styles.textInput}
              />
              <Button title="Send" onPress={send} />
            </View>
          </>
        )}
      </View>
      
      {/* Replace renderBottomNav() with the Navbar component */}
      <Navbar 
        ref={navbarRef}
        activeScreen="Slack" 
        opacityValue={navOpacity} 
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  workspaceText: {
    marginBottom: 12,
    textAlign: 'center',
    fontSize: 16,
  },
  loader: {
    marginVertical: 20,
  },
  messagesList: {
    paddingBottom: 12,
  },
  messageItem: {
    padding: 8,
    borderBottomWidth: 1,
    borderColor: '#ddd',
  },
  messageUser: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  messageText: {
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 8,
    borderRadius: 6,
  },
});
