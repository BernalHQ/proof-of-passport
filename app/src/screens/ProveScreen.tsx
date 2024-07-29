import React, { useState, useEffect } from 'react';
import { YStack, XStack, Text, Checkbox, Input, Button, Spinner, Image, useWindowDimensions, ScrollView, Fieldset } from 'tamagui';
import { Check, Share, } from '@tamagui/lucide-icons';
import { attributeToPosition, DEFAULT_MAJORITY, } from '../../../common/src/constants/constants';
import USER from '../images/user.png'
import { bgGreen, borderColor, componentBgColor, componentBgColor2, separatorColor, textBlack, textColor1, textColor2 } from '../utils/colors';
import { ethers } from 'ethers';
import { Platform } from 'react-native';
import { formatAttribute, Steps } from '../utils/utils';
import { downloadZkey } from '../utils/zkeyDownload';
import useUserStore from '../stores/userStore';
import useNavigationStore from '../stores/navigationStore';
import { AppType } from '../../../common/src/utils/appType';
import useSbtStore from '../stores/sbtStore';
import CustomButton from '../components/CustomButton';
import { generateCircuitInputsDisclose } from '../../../common/src/utils/generateInputs';
import { PASSPORT_ATTESTATION_ID } from '../../../common/src/constants/constants';
import axios from 'axios';
import { stringToNumber } from '../../../common/src/utils/utils';
import { revealBitmapFromAttributes } from '../../../common/src/utils/revealBitmap';
import { getTreeFromTracker } from '../../../common/src/utils/pubkeyTree';
import { generateProof } from '../utils/prover';
import io, { Socket } from 'socket.io-client';

interface ProveScreenProps {
  setSheetRegisterIsOpen: (value: boolean) => void;
}

const ProveScreen: React.FC<ProveScreenProps> = ({ setSheetRegisterIsOpen }) => {
  const [generatingProof, setGeneratingProof] = useState(false);
  const selectedApp = useNavigationStore(state => state.selectedApp) as AppType;
  const {
    hideData,
    isZkeyDownloading,
    step,
    toast,
    setSelectedTab
  } = useNavigationStore()

  const {
    secret,
    setProofVerificationResult
  } = useUserStore()

  const [proofStatus, setProofStatus] = useState<string>('');

  const [socket, setSocket] = useState<Socket | null>(null);

  const [isConnecting, setIsConnecting] = useState(false);

  const waitForSocketConnection = (socket: Socket): Promise<void> => {
    return new Promise((resolve) => {
      if (socket.connected) {
        resolve();
      } else {
        socket.once('connect', () => {
          resolve();
        });
      }
    });
  };

  useEffect(() => {
    const newSocket = io('https://proofofpassport-merkle-tree.xyz', {
      path: '/websocket',
      transports: ['websocket'],
      query: { sessionId: selectedApp.userId, clientType: 'mobile' }
    });

    newSocket.on('connect', () => {
      console.log('Connected to WebSocket server');
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });

    newSocket.on('proof_verification_result', (result) => {
      console.log('Proof verification result:', result);
      setProofVerificationResult(JSON.parse(result));
      setProofStatus(`Proof verification result: ${result}`);
      console.log("result", result);
      setSelectedTab(JSON.parse(result).valid ? "valid" : "wrong");
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [selectedApp.userId]);

  const handleProve = async () => {
    try {
      setIsConnecting(true);
      setGeneratingProof(true);

      if (!socket) {
        throw new Error('Socket not initialized');
      }

      await waitForSocketConnection(socket);

      setIsConnecting(false);
      setProofStatus('Generating proof...');
      socket.emit('proof_generation_start', { sessionId: selectedApp.userId });

      const tree = await getTreeFromTracker();

      const inputs = generateCircuitInputsDisclose(
        secret,
        PASSPORT_ATTESTATION_ID,
        passportData,
        tree as any,
        (selectedApp.disclosureOptions && selectedApp.disclosureOptions.older_than) ? selectedApp.disclosureOptions.older_than : DEFAULT_MAJORITY,
        revealBitmapFromAttributes(selectedApp.disclosureOptions as any),
        selectedApp.scope,
        stringToNumber(selectedApp.userId).toString()
      );

      console.log("inputs", inputs);
      const localProof = await generateProof(
        selectedApp.circuit,
        inputs,
      );

      setProofStatus('Sending proof to verification...');
      // console.log("localProof", localProof);

      // Send the proof via WebSocket
      const formattedLocalProof = {
        proof: {
          pi_a: [
            localProof.proof.a[0],
            localProof.proof.a[1],
            "1"
          ],
          pi_b: [
            [localProof.proof.b[0][0], localProof.proof.b[0][1]],
            [localProof.proof.b[1][0], localProof.proof.b[1][1]],
            ["1", "0"]
          ],
          pi_c: [
            localProof.proof.c[0],
            localProof.proof.c[1],
            "1"
          ],
          protocol: "groth16",
          curve: "bn128"
        },
        publicSignals: (localProof as any).pub_signals
      };
      // console.log("formattedLocalProof", formattedLocalProof);
      socket.emit('proof_generated', { sessionId: selectedApp.userId, proof: formattedLocalProof });

      // Wait for verification result
      const verificationResult = await new Promise((resolve) => {
        socket.once('proof_verification_result', resolve);
      });

      setProofStatus(`Proof verification result: ${(verificationResult)}`);

    } catch (error) {
      console.error('Error in handleProve:', error);
      setProofStatus(`Error: ${error || 'An unknown error occurred'}`);
    } finally {
      setGeneratingProof(false);
      setIsConnecting(false);
    }
  };

  const {
    registered,
    passportData,
  } = useUserStore();

  const handleDisclosureChange = (field: string) => {
    const requiredOrOptional = selectedApp.disclosureOptions[field as keyof typeof selectedApp.disclosureOptions];
    if (requiredOrOptional === 'required') {
      return;
    }
  };
  const { height } = useWindowDimensions();

  useEffect(() => {
  }, [])

  const disclosureFieldsToText = (key: string, value: string = "") => {
    if (key === 'older_than') {
      return `I am older than ${value} years old.`;
    }
    if (key === 'nationality') {
      return `I got a valid passport from ${value}.`;
    }
    return '';
  }

  return (
    <YStack f={1} p="$3">

      {Object.keys(selectedApp.disclosureOptions as any).length > 0 ? <YStack mt="$4">
        <Text fontSize="$9">
          <Text fow="bold" style={{ textDecorationLine: 'underline', textDecorationColor: bgGreen }}>{selectedApp.name}</Text> is requesting you to prove the following information.
        </Text>
        <Text mt="$3" fontSize="$8" color={textBlack} >

          No <Text style={{ textDecorationLine: 'underline', textDecorationColor: bgGreen }}>other</Text> information than the one selected below will be shared with {selectedApp.name}.
        </Text>
      </YStack> :
        <Text fontSize="$9">
          <Text fow="bold" style={{ textDecorationLine: 'underline', textDecorationColor: bgGreen }}>{selectedApp.name}</Text> is requesting you to prove you own a valid passport.
        </Text>
      }

      <YStack mt="$6">


        {selectedApp && Object.keys(selectedApp.disclosureOptions as any).map((key) => {
          const key_ = key;
          const indexes = attributeToPosition[key_ as keyof typeof attributeToPosition];
          const keyFormatted = key_.replace(/_/g, ' ').split(' ').map((word: string) => word.charAt(0) + word.slice(1)).join(' ');
          const mrzAttribute = passportData.mrz.slice(indexes[0], indexes[1] + 1);
          const mrzAttributeFormatted = formatAttribute(key_, mrzAttribute);

          return (
            <XStack key={key} gap="$3" alignItems='center'>

              <Fieldset gap="$2.5" horizontal>
                <XStack p="$2" onPress={() => handleDisclosureChange(key_)} >
                  <Checkbox
                    borderColor={separatorColor}
                    value={key}
                    onCheckedChange={() => handleDisclosureChange(key_)}
                    aria-label={keyFormatted}
                    size="$6"
                  >
                    <Checkbox.Indicator >
                      <Check color={textBlack} />
                    </Checkbox.Indicator>
                  </Checkbox>
                </XStack>
                {key_ === 'older_than' ? (
                  <XStack gap="$1.5" jc='center' ai='center'>
                    <XStack mr="$2">
                      <Text color={textBlack} fontSize="$6">{disclosureFieldsToText('older_than', (selectedApp.disclosureOptions as any).older_than)}</Text>
                    </XStack>
                  </XStack>
                ) : (
                  <Text fontSize="$6"
                    w="80%"
                    color={textBlack}

                  >
                    {disclosureFieldsToText(keyFormatted, (selectedApp.disclosureOptions as any).nationality)}
                  </Text>
                )}
              </Fieldset>


            </XStack>
          );
        })}
      </YStack>

      <XStack f={1} />



      {/* <XStack ai="center" gap="$2" mb="$2.5" ml="$2">
        <XStack onPress={handleAcknoledge} p="$2">
          <Checkbox size="$6" checked={acknowledged} onCheckedChange={handleAcknoledge} borderColor={separatorColor}>
            <Checkbox.Indicator>
              <Check color={textBlack} />
            </Checkbox.Indicator>
          </Checkbox>
        </XStack>
        <Text style={{ fontStyle: 'italic' }} w="85%">I acknowledge sharing the selected information with {selectedApp.name}</Text>
      </XStack> */}


      <CustomButton
        Icon={isConnecting ? <Spinner /> : generatingProof ? <Spinner /> : <Share />}
        isDisabled={isConnecting || generatingProof}
        text={isConnecting ? "Connecting..." : generatingProof ? "Generating Proof..." : "Prove"}
        onPress={registered ? handleProve : () => setSheetRegisterIsOpen(true)}
        bgColor={isConnecting || generatingProof ? separatorColor : bgGreen}
        disabledOnPress={() => toast.show('⏳', {
          message: isConnecting ? "Connecting to server..." : "Proof is generating",
          customData: {
            type: "info",
          },
        })}
      />


      {/* {proofStatus && (
        <Text mt="$4" fontSize="$6" color={textBlack}>
          {proofStatus}
        </Text>
      )} */}

    </YStack >
  );
};

export default ProveScreen;